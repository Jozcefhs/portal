import nativeVm from 'node:vm';
import * as authority from '../../functions/lib/module-authority.js';
import * as curriculum from '../../functions/lib/academic-curriculum-settings.js';
import { explicitModulesForUser } from '../../functions/lib/role-module-access.js';

// Source-isolation tests remove ESM imports. Supply the real permission and
// curriculum helpers, while still letting each fixture override dependencies.
const globals = context => {
  const supplied = context || {};
  Object.assign(supplied, { ...authority, ...curriculum, explicitModulesForUser, ...supplied });
  if (supplied.__imports) supplied.__imports = {
    './module-authority.js': authority, '../lib/module-authority.js': authority,
    './academic-curriculum-settings.js': curriculum, ...supplied.__imports
  };
  return supplied;
};
export const runInNewContext = (code, context, options) => nativeVm.runInNewContext(code, globals(context), options);
export default { ...nativeVm, runInNewContext,
  createContext: (context, options) => nativeVm.createContext(globals(context), options) };
