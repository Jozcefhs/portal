(function installDisplayTime(global) {
  // Stored instants remain UTC. Only presentation uses the organisation's time zone.
  const DEFAULT_TIME_ZONE = 'Africa/Lagos';
  const timestampPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
  const zonedPattern = /(?:Z|[+-]\d{2}:?\d{2})$/i;
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const formatters = new Map();

  function formatter(timeZone) {
    const zone = timeZone || DEFAULT_TIME_ZONE;
    if (!formatters.has(zone)) {
      // Do not retain arbitrary caller-supplied zones indefinitely.
      if (formatters.size >= 16) formatters.clear();
      formatters.set(zone, new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }));
    }
    return formatters.get(zone);
  }

  function isTimestamp(value) {
    return typeof value === 'string' && timestampPattern.test(value.trim());
  }

  function display(value, kind, timeZone) {
    if (value === null || value === undefined || value === '') return '';
    const text = String(value).trim();
    if (dateOnlyPattern.test(text)) return kind === 'time' ? '' : text;
    // Older desktop records and datetime-local fields contain wall-clock values,
    // not UTC instants. Preserve their clock rather than guessing a time zone.
    if (isTimestamp(text) && !zonedPattern.test(text)) {
      if (kind === 'date') return text.slice(0, 10);
      if (kind === 'time') return text.slice(11, 16);
      return text.replace('T', ' ').slice(0, 19);
    }
    const isDate = Object.prototype.toString.call(value) === '[object Date]';
    if (!isDate && typeof value !== 'number' && !isTimestamp(text)) return text;
    const date = isDate ? value : new Date(typeof value === 'number' ? value : text.replace(' ', 'T'));
    if (!Number.isFinite(date.getTime())) return text;
    let zone = timeZone || DEFAULT_TIME_ZONE;
    let selected;
    try { selected = formatter(zone); } catch {
      zone = DEFAULT_TIME_ZONE;
      selected = formatter(zone);
    }
    const parts = Object.fromEntries(selected.formatToParts(date)
      .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const clock = `${parts.hour}:${parts.minute}`;
    if (kind === 'date') return day;
    if (kind === 'time') return clock;
    const label = zone === DEFAULT_TIME_ZONE ? 'WAT' : zone;
    return `${day} ${clock}:${parts.second} ${label}`;
  }

  global.DynamaxTime = Object.freeze({
    DEFAULT_TIME_ZONE,
    isTimestamp,
    formatDateTime: (value, timeZone) => display(value, 'datetime', timeZone),
    formatDate: (value, timeZone) => display(value, 'date', timeZone),
    formatTime: (value, timeZone) => display(value, 'time', timeZone),
    formatCell: (value) => isTimestamp(value) ? display(value, 'datetime') : value
  });
})(globalThis);
