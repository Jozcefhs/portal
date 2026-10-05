const clean = (value) => String(value ?? '').trim();

// A missing status already means Active in wallet operations. Use the same
// read-only projection everywhere, without issuing a card or changing a balance.
// Saved canonical restrictions must win over stale lower-case import aliases.
export function studentWalletProfile(row = {}) {
  const status = clean(row.WalletCardStatus) || clean(row.walletCardStatus) || 'Active';
  const labels = { active: 'Active', blocked: 'Blocked', lost: 'Lost', replaced: 'Replaced', 'not issued': 'Not Issued' };
  return {
    WalletCardId: clean(row.WalletCardId) || clean(row.walletCardId),
    WalletCardStatus: labels[status.toLowerCase()] || status
  };
}
