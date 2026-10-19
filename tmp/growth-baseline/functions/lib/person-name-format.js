const clean = (value) => String(value ?? '').trim();

export const DEFAULT_NAME_FORMAT = 'Surname, first name, middle name';

const NAME_PART_LABELS = Object.freeze({
  'first name': 'first name',
  'middle name': 'middle name',
  surname: 'surname'
});

export function nameFormatOrder(value) {
  const supported = new Set(Object.keys(NAME_PART_LABELS));
  const order = clean(value).toLowerCase().split(',').map(clean)
    .filter((part, index, parts) => supported.has(part) && parts.indexOf(part) === index);
  return order.length === supported.size
    ? order
    : ['surname', 'first name', 'middle name'];
}

export function normalizeNameFormat(value) {
  return nameFormatOrder(value)
    .map((part, index) => {
      const label = NAME_PART_LABELS[part];
      return index === 0 ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;
    })
    .join(', ');
}

export function personNameFormatProfile({ env = {}, organizationProfile = {}, legacyProfile = {} } = {}) {
  return {
    NameFormat: normalizeNameFormat(
      organizationProfile?.NameFormat || organizationProfile?.nameFormat
      || legacyProfile?.NameFormat || legacyProfile?.nameFormat
      || env.NAME_FORMAT || DEFAULT_NAME_FORMAT
    )
  };
}

export function formatPersonName(row = {}, profile = {}, fallback = '') {
  const parts = {
    'first name': clean(row.FirstName || row.firstName || row.GivenName || row.givenName),
    'middle name': clean(row.MiddleName || row.middleName || row.OtherName || row.otherName),
    surname: clean(row.Surname || row.surname || row.LastName || row.lastName || row.FamilyName || row.familyName)
  };
  const formatted = nameFormatOrder(profile.NameFormat || profile.nameFormat)
    .map((part) => parts[part])
    .filter(Boolean)
    .join(' ');
  return formatted || clean(fallback || row.DisplayName || row.displayName || row.Username || row.username);
}
