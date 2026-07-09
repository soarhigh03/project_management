#!/usr/bin/env node
// 비밀번호 해시 생성기
// 사용법: npm run hash -- "비밀번호"   또는   node scripts/hash-password.js "비밀번호"
import { hashPassword, verifyPassword } from '../lib/auth.js';

const pw = process.argv[2];
if (!pw) {
  console.error('사용법: npm run hash -- "비밀번호"');
  process.exit(1);
}
if (pw.length < 6) {
  console.error('비밀번호는 6자 이상을 권장합니다.');
}
const hash = hashPassword(pw);
if (!verifyPassword(pw, hash)) {
  console.error('내부 오류: 해시 검증 실패');
  process.exit(1);
}
console.log('\n아래 해시를 config/projects.js의 passwordHash에 붙여넣으세요:\n');
console.log(hash + '\n');
