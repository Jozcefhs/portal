export function storeLocationFields(body) {
  const fields = {};
  for (const key of ['StoreArea', 'ShelfBin']) {
    if (!Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== 'string' || body[key].trim().length > 80) {
      throw Object.assign(new Error('Store area and shelf or bin must each be at most 80 characters.'), { status: 400 });
    }
    fields[key] = body[key].trim();
  }
  return fields;
}

export function storeLocationLabel(item) {
  return [item?.StoreArea, item?.ShelfBin].filter(Boolean).join(' / ');
}
