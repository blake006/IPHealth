'use strict';

/**
 * 版本号推进器
 *
 * 规则：次版本 0~10 顺次递增，满 10 后进位到下一个次版本，补丁位归零。
 *   1.1.0 → 1.1.1 → … → 1.1.10 → 1.2.0 → … → 1.2.10 → 1.3.0
 *
 * 用法：
 *   node scripts/bump-version.js            # 自动 +1
 *   node scripts/bump-version.js 1.3.0      # 指定版本
 *   node scripts/bump-version.js --dry-run  # 只看结果不写文件
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');

function nextVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!m) throw new Error(`版本号格式不对：${version}（应为 x.y.z）`);
  const [, maj, min, pat] = m.map(Number);
  if (pat < 10) return `${maj}.${min}.${pat + 1}`;
  return `${maj}.${min + 1}.0`;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const cur = pkg.version;
  const next = args[0] ? args[0].trim() : nextVersion(cur);

  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error(`版本号格式不对：${next}（应为 x.y.z）`);
    process.exit(1);
  }

  console.log(`${cur} → ${next}`);
  if (dryRun) return;

  pkg.version = next;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('已写入 package.json（打包脚本会自动读取）');
}

if (require.main === module) main();

module.exports = { nextVersion };
