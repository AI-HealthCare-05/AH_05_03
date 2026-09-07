/**
 * 초대 링크로 들어왔는지, 왔다면 어느 이메일인지.
 *
 * 로그인 화면과 가입 화면이 **둘 다** 알아야 한다 — 초대받은 사람은 계정이 있을
 * 수도 없을 수도 있다. 두 화면이 각자 파싱하면 한쪽만 고쳐지는 날이 온다.
 *
 * 해시에서 읽는 이유: 초대 토큰이 쿼리스트링에 있으면 nginx 액세스 로그와 리퍼러에
 * 남는다. 해시는 서버로 가지 않는다.
 */

export function invitationEmail(): string | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  if (!params.get("invitation") || !params.get("token")) return undefined;
  return params.get("email") ?? undefined;
}
