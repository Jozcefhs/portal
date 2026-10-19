const APPROVED_FUNCTIONS = new Set(['MIN', 'MAX', 'ROUND']);

function formulaError(message, position = null) {
  const error = new Error(position === null ? message : `${message} at position ${position}.`);
  error.status = 400;
  error.code = 'INVALID_PAYROLL_FORMULA';
  return error;
}

function tokenize(source) {
  const text = String(source ?? '').trim();
  if (!text) throw formulaError('Formula is required');
  if (text.length > 500) throw formulaError('Formula is too long');
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[+\-*/(),]/.test(char)) { tokens.push({ type: char, value: char, position: index }); index += 1; continue; }
    if (/\d|\./.test(char)) {
      const start = index; let dots = 0;
      while (index < text.length && /\d|\./.test(text[index])) { if (text[index] === '.') dots += 1; index += 1; }
      const raw = text.slice(start, index);
      if (dots > 1 || raw === '.' || !Number.isFinite(Number(raw))) throw formulaError('Invalid number', start);
      tokens.push({ type: 'number', value: Number(raw), position: start });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) index += 1;
      tokens.push({ type: 'identifier', value: text.slice(start, index), position: start });
      continue;
    }
    throw formulaError(`Unsupported character "${char}"`, index);
  }
  if (tokens.length > 200) throw formulaError('Formula contains too many tokens');
  tokens.push({ type: 'eof', value: '', position: text.length });
  return tokens;
}

export function parsePayrollFormula(source) {
  const tokens = tokenize(source); let cursor = 0; const variables = new Set();
  const peek = () => tokens[cursor];
  const take = (type) => {
    const token = peek();
    if (token.type !== type) throw formulaError(`Expected ${type} but found ${token.type}`, token.position);
    cursor += 1; return token;
  };
  const parseExpression = () => {
    let node = parseTerm();
    while (['+', '-'].includes(peek().type)) { const operator = take(peek().type); node = { type: 'binary', operator: operator.type, left: node, right: parseTerm() }; }
    return node;
  };
  const parseTerm = () => {
    let node = parseUnary();
    while (['*', '/'].includes(peek().type)) { const operator = take(peek().type); node = { type: 'binary', operator: operator.type, left: node, right: parseUnary() }; }
    return node;
  };
  const parseUnary = () => {
    if (['+', '-'].includes(peek().type)) { const operator = take(peek().type); return { type: 'unary', operator: operator.type, operand: parseUnary() }; }
    return parsePrimary();
  };
  const parsePrimary = () => {
    const token = peek();
    if (token.type === 'number') { take('number'); return { type: 'number', value: token.value }; }
    if (token.type === '(') { take('('); const node = parseExpression(); take(')'); return node; }
    if (token.type === 'identifier') {
      take('identifier');
      if (peek().type === '(') {
        const name = token.value.toUpperCase();
        if (!APPROVED_FUNCTIONS.has(name)) throw formulaError(`Function ${token.value} is not allowed`, token.position);
        take('('); const args = [];
        if (peek().type !== ')') { args.push(parseExpression()); while (peek().type === ',') { take(','); args.push(parseExpression()); } }
        take(')');
        if ((name === 'MIN' || name === 'MAX') && args.length < 1) throw formulaError(`${name} requires at least one argument`, token.position);
        if (name === 'ROUND' && ![1, 2].includes(args.length)) throw formulaError('ROUND requires one or two arguments', token.position);
        return { type: 'call', name, args };
      }
      variables.add(token.value); return { type: 'variable', name: token.value };
    }
    throw formulaError(`Unexpected ${token.type}`, token.position);
  };
  const ast = parseExpression();
  if (peek().type !== 'eof') throw formulaError(`Unexpected ${peek().type}`, peek().position);
  return { ast, variables: [...variables] };
}

function variableMap(values) {
  const map = new Map();
  Object.entries(values || {}).forEach(([key, value]) => map.set(String(key).toLowerCase(), Number(value)));
  return map;
}

export function evaluatePayrollFormula(sourceOrParsed, variables = {}) {
  const parsed = typeof sourceOrParsed === 'string' ? parsePayrollFormula(sourceOrParsed) : sourceOrParsed;
  const values = variableMap(variables);
  const evaluate = (node) => {
    if (node.type === 'number') return node.value;
    if (node.type === 'variable') {
      const value = values.get(node.name.toLowerCase());
      if (!Number.isFinite(value)) throw formulaError(`Variable ${node.name} is missing or not numeric`);
      return value;
    }
    if (node.type === 'unary') return node.operator === '-' ? -evaluate(node.operand) : evaluate(node.operand);
    if (node.type === 'binary') {
      const left = evaluate(node.left); const right = evaluate(node.right);
      if (node.operator === '+') return left + right;
      if (node.operator === '-') return left - right;
      if (node.operator === '*') return left * right;
      if (Math.abs(right) < Number.EPSILON) throw formulaError('Division by zero is not allowed');
      return left / right;
    }
    const args = node.args.map(evaluate);
    if (node.name === 'MIN') return Math.min(...args);
    if (node.name === 'MAX') return Math.max(...args);
    const precision = args.length === 2 ? args[1] : 0;
    if (!Number.isInteger(precision) || precision < 0 || precision > 6) throw formulaError('ROUND precision must be an integer from 0 to 6');
    const factor = 10 ** precision; return Math.round((args[0] + Number.EPSILON) * factor) / factor;
  };
  const result = evaluate(parsed.ast);
  if (!Number.isFinite(result)) throw formulaError('Formula result is not a finite number');
  return result;
}

export function validatePayrollFormula(source, allowedVariables = []) {
  const parsed = parsePayrollFormula(source);
  const allowed = new Set((allowedVariables || []).map((value) => String(value).toLowerCase()));
  const unknown = parsed.variables.filter((name) => !allowed.has(name.toLowerCase()));
  if (unknown.length) throw formulaError(`Unknown variable(s): ${unknown.join(', ')}`);
  return { ok: true, variables: parsed.variables, ast: parsed.ast };
}
