// ============================================================
//  프로젝트 설정 파일 — 이 파일 하나로 모든 프로젝트를 관리합니다.
//
//  · passwordHash : 절대 비밀번호 원문을 쓰지 마세요!
//                   터미널에서  npm run hash -- "비밀번호"  실행 후
//                   출력된 해시를 붙여넣으세요. (scrypt 해시라 유출돼도
//                   원문 복원이 어렵지만, 저장소는 private 권장)
//  · members      : 담당자 지정에 쓰이는 팀원 이름 목록
//  · regions      : 버그 신고 시 선택하는 앱 영역(페이지) 목록
//  · urgencies    : (선택) 긴급도 목록을 바꾸고 싶을 때만 정의
//  · listed       : false로 두면 홈 화면 목록에서 숨김
//                   (프로젝트 ID를 아는 사람만 직접 입력해서 입장)
// ============================================================

export default [
  {
    id: 'demo',                     // URL에 쓰임: /p/demo/... (소문자·숫자·하이픈)
    name: '데모 프로젝트',
    // 비밀번호: demo1234 (배포 전에 꼭 바꾸세요!)
    passwordHash: 'scrypt:16384:8:1:870878e0391a6b2cf8941491e6b264ad:4cc9f2b81bf31b20a30b1a354e7de349f2a67a9b92f4e0789b2c299e55fe65af',
    members: ['미잘', '은우', '팀원A'],
    regions: ['홈', '검색', '설정', '프로필', '기타'],
    // urgencies: [
    //   { id: 'low', name: '낮음' },
    //   { id: 'mid', name: '보통' },
    //   { id: 'high', name: '높음' },
    //   { id: 'critical', name: '긴급' },
    // ],
  },

  {
    id: 'patz',
    name: 'patz',
    // 비밀번호: threeever
    passwordHash: 'scrypt:16384:8:1:a3107cbc72e79a9de93c081bbbe019fc:ed89a334818401622794c80f389725b55cc5fd167375ced6c7e2d2cb3ca1d4f0',
    members: ['채은', '민우', '은우'],
    regions: ['홈', '탐색', '지도', '커뮤니티', '설정', 'DB'],
  },

  {
    id: 'jarvis',
    name: 'jarvis',
    // 비밀번호: stark
    passwordHash: 'scrypt:16384:8:1:7471c5ef3293f28b2523ee8c85f1a42a:01b24325d8e35cdfe05d51a3ad9bcc6772c2eea659b002aae96f27e287cd81d9',
    members: ['호승', '동휘', '유리', '은우'],
    regions: ['디자인', 'AI', '프론트', '기획'],
  },

  {
    id: 'mijal',
    name: '말미잘',
    // 비밀번호: mijal
    passwordHash: 'scrypt:16384:8:1:5d9051180d202be50753be732c0cd77e:7c8f14327c41930f7492f66c17dd1367eeecdf93b0efad03dee5fc0ac68dd51d',
    members: ['병호', '경민', '은우'],
    regions: ['홈', '매일 한마디', '세줄요약', '따라 읽기', '스트릭', '설정'],
  },

  // 프로젝트를 추가하려면 위 블록을 복사해서 붙여넣고 수정하세요.
  // {
  //   id: 'my-app',
  //   name: '내 앱',
  //   passwordHash: 'scrypt:...',
  //   members: ['이름1', '이름2'],
  //   regions: ['홈', '로그인', '결제'],
  //   listed: false,
  // },
];
