const TISTORY_ACCOUNT_ID = 'tistory-shared';
function normalizeTistoryBlogId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const id = raw.replace(/^https?:\/\//, '').replace(/\.tistory\.com\/?$/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(id)) throw new Error('티스토리 Blog ID 또는 https://블로그ID.tistory.com 형식으로 입력하세요.');
  return id;
}
function tistoryAccount(blogId) {
  const id = normalizeTistoryBlogId(blogId);
  if (!id) throw new Error('티스토리 Blog ID가 필요합니다.');
  return {id:TISTORY_ACCOUNT_ID, blogId:id, label:'티스토리 공용 로그인', platform:'tistory'};
}
module.exports = {TISTORY_ACCOUNT_ID, normalizeTistoryBlogId, tistoryAccount};
