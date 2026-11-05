'use strict';
const os = require('os');

/** 這台電腦在區網（同一個 Wi-Fi）上的 IPv4 位址，私人網段優先 */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      if (/vmware|virtualbox|vethernet|docker|wsl|hyper-v|loopback/i.test(name)) continue;
      out.push(a.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return [...new Set(out)].sort((x, y) => rank(x) - rank(y));
}

module.exports = { lanAddresses };
