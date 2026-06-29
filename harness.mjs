import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

// 프로젝트 루트의 .env 로드 (Node 20.12+ 내장, 별도 패키지 불필요)
try {
  process.loadEnvFile();
} catch {
  // .env 파일이 없어도 실제 환경변수가 있으면 진행
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY가 없습니다. 프로젝트 루트에 .env 파일을 만들고 키를 넣어주세요.");
  console.error("   예: ANTHROPIC_API_KEY=sk-ant-...");
  process.exit(1);
}

const client = new Anthropic();

// ────────────────────────────────────────────
// 과제 컨텍스트 (모든 에이전트가 공유)
// ────────────────────────────────────────────
const TASK_CONTEXT = `
[과제 조건]
- 핵심 과제: 6명의 동료가 1시간 회의 일정을 잡는 경험 설계 (Web/App UI)
- 인원/기간/시간: 동료 6명, 다음 주까지 모여야 함, 회의 시간은 정확히 1시간
- 개인별 선호도: 특정 인물은 점심 직후 시간대를 기피함
- 일정상 제약: 특정 인물은 특정 요일에 외근이 많음
- 참석자 우선순위: 필수 참석자와 선택 참석자가 나뉨 (가중치 반영 필요)

[토스 평가 기준]
1. 본질적인 문제 정의 (Problem Definition)
2. 가설 기반의 솔루션 설계 (Solution Design)
3. 조형적 완성도와 디테일 (Visual Perfection)

[토스 핵심 가치]
- 복잡함의 단순화
- Full-Cycle 오너십 (Trigger → 확정 → 알림까지)
- 논리적 설득력
`;

// ────────────────────────────────────────────
// 에이전트 정의
// ────────────────────────────────────────────
const AGENTS = {
  "problem-framer": {
    label: "Agent A: Problem Framer",
    emoji: "🔍",
    role: "UX 리서처 / 문제 정의 전문가",
    why: `
**왜 이 에이전트가 필요한가?**

기획의 첫 단추는 "무엇을 만들 것인가"가 아니라 "무엇이 진짜 문제인가"입니다.
일정 조율이 어렵다는 건 표면적 현상일 뿐이에요.
그 이면에 있는 심리적·행동적 허들 — 인지 과부하, 눈치 보기, 조율 책임의 분산 —
을 먼저 날카롭게 짚지 않으면, 아무리 좋은 UI를 만들어도 핵심을 빗나갑니다.

이 에이전트는 실제 팀에서 UX 리서처나 PM이 킥오프 미팅에서 
"우리가 정말 풀어야 할 문제가 뭔지" 먼저 정리하는 역할과 같아요.
    `,
    systemPrompt: `당신은 토스(Toss) 스타일의 UX 리서처입니다.
표면적 불편함이 아니라, 사용자의 심리적·행동적 본질 문제를 날카롭게 정의하는 전문가입니다.

다음 과제 조건을 바탕으로:
1. 기존 일정 조율 방식(카카오톡, 이메일 등)에서 사용자가 겪는 본질적 문제 3가지를 정의하세요.
2. 각 문제에 대해 "왜 그것이 문제인가" — 심리적·행동적 관점에서 설명하세요.
3. 필수/선택 참석자 구분, 외근 패턴, 점심 후 기피 같은 조건이 문제를 어떻게 심화시키는지 분석하세요.

응답은 명확한 마크다운 헤딩으로 구조화하고, 각 문제는 한 줄 문장으로 요약한 뒤 설명을 붙이세요.`,
  },

  "ux-designer": {
    label: "Agent B: UX Designer",
    emoji: "🎨",
    role: "프로덕트 디자이너 / 인터랙션 설계자",
    why: `
**왜 이 에이전트가 필요한가?**

문제가 정의된 다음엔, 그것을 "어떻게 풀 것인가"를 설계해야 합니다.
여기서 중요한 건 기능 나열이 아니라 가설 기반 UX 설계예요.
"~게 보여주면 사용자는 ~게 인지하여 ~게 행동할 것이다"라는 
명확한 설계 의도와 근거가 있어야 토스 수준의 기획이 됩니다.

이 에이전트는 실제 팀에서 프로덕트 디자이너가 
화이트보드 앞에서 유저 플로우를 설계하고 각 화면의 의도를 설명하는 역할이에요.
    `,
    systemPrompt: `당신은 토스(Toss) 스타일의 프로덕트 디자이너입니다.
복잡한 조건을 학습 없이 직관적으로 이해할 수 있는 UX로 풀어내는 전문가입니다.

Problem Framer가 정의한 문제들을 해결하기 위해:
1. Trigger → 일정 제안 → 참여자 응답 → 확정 → 알림까지의 전체 유저 플로우를 설계하세요.
2. 핵심 화면 3개를 선정하고, 각 화면의 UI 구성 요소와 설계 의도(가설)를 설명하세요.
   형식: "~게 표시하면, 사용자는 ~게 인지하여, ~게 행동할 것이다"
3. 필수/선택 참석자 가중치를 시각적으로 어떻게 표현할지 구체적으로 설명하세요.

응답은 플로우 다이어그램(텍스트 형태)과 화면별 설계 의도로 구성하세요.`,
  },

  "visual-critic": {
    label: "Agent C: Visual Critic",
    emoji: "✏️",
    role: "UI 스페셜리스트 / 비주얼 디테일 검증자",
    why: `
**왜 이 에이전트가 필요한가?**

토스의 디자인은 "흔한 캘린더 UI를 이 맥락에 맞게 픽셀 단위로 다듬는 것"을 요구합니다.
좋은 UX 플로우가 있어도, 실제 화면에서 컬러·타이포·간격·컴포넌트 상태가 
이 특수한 맥락(필수/선택, 외근, 기피 시간대)을 제대로 반영하지 않으면
기획서의 완성도가 크게 떨어져요.

이 에이전트는 실제 팀에서 UI 디자이너가 
디자인 리뷰에서 "이 색이 여기서 맞나?", "이 상태 표현이 명확한가?"를 
짚어주는 역할이에요.
    `,
    systemPrompt: `당신은 토스(Toss) 스타일의 UI 스페셜리스트입니다.
기존 UI 패턴을 맥락에 맞게 픽셀 단위로 정교하게 다듬는 전문가입니다.

UX Designer의 설계를 바탕으로:
1. 이 과제의 특수한 맥락(필수/선택 참석자, 외근 요일, 점심 후 기피)을 표현하기 위한
   색상, 타이포그래피, 아이콘 시스템을 구체적으로 제안하세요.
2. 가용/불가/기피/외근 4가지 상태를 어떻게 시각적으로 구분할지
   컬러 코드와 이유를 함께 제시하세요.
3. 모바일 vs 데스크톱에서 달라져야 할 레이아웃 포인트를 설명하세요.
4. 토스 디자인 시스템에서 영감을 받은 컴포넌트 디테일 2가지를 구체적으로 제안하세요.

응답에는 실제 hex 컬러 코드와 구체적인 수치(px, rem 등)를 포함하세요.`,
  },

  "user-qa": {
    label: "Agent D: User QA Panel",
    emoji: "👥",
    role: "실사용자 QA / 페르소나 검증자",
    why: `
**왜 이 에이전트가 필요한가?**

지금까지의 에이전트는 전부 "만드는 쪽"의 전문가 관점입니다.
문제 정의·설계·시각 디테일 모두 디자이너의 시선이에요.
하지만 토스 평가 기준 2번(가설 기반 솔루션)은 가설이 *검증*되어야 설득력을 가집니다.

이 에이전트는 한 명이지만, 과제 시나리오에 등장하는 6명의 동료 페르소나에
각각 빙의하여 설계된 플로우를 실제로 사용해봅니다.
UX Designer가 세운 "~게 보여주면 ~게 인지할 것"이라는 가설을
실사용자가 직접 밟아보며 "여기서 막혔다"를 던지는 사용성 QA 역할이에요.

순서상 Visual Critic 다음, Toss Evaluator 앞에 두어
사용자 검증 결과가 최종 평가에 반영되도록 했습니다.
    `,
    systemPrompt: `당신은 토스(Toss) 서비스의 실제 사용자 역할을 연기하는 QA 전문가입니다.
한 명이지만, 이 회의 시나리오에 등장하는 6명의 동료 페르소나에 각각 빙의하여,
UX Designer와 Visual Critic이 설계한 플로우/화면을 1인칭으로 직접 사용해봅니다.

[연기할 6명의 페르소나]
1. 주최자 — 회의를 소집하고 다음 주까지 빨리 확정해야 하는 사람. 조율 책임의 부담을 느낌.
2. 점심 직후 기피자 — 식곤증 때문에 점심 직후 시간대를 피하고 싶음.
3. 외근 잦은 동료 — 특정 요일에 외근이 많아 일정 충돌이 잦음.
4. 선택 참석자 — 필수가 아니라 우선순위가 낮고, "내 사정이 반영될까" 눈치를 봄.
5. 바쁜 필수 참석자(리더) — 시간이 없고 빠른 의사결정을 선호함.
6. 신규입사자/디지털 약자 — 학습 없이 직관적으로 쓸 수 있어야 함.

각 페르소나에 대해, 그 사람의 입장에서 설계된 플로우를 사용해보고 다음을 작성하세요:
- **첫인상**: 화면을 처음 봤을 때 드는 생각/감정
- **막히는 지점**: 어디서 헷갈리거나 멈칫하는가
- **오해할 부분**: 잘못 이해할 수 있는 표현/UI
- **감정 반응**: 안심/불안/짜증/만족 등 솔직한 감정
- **한 줄 제안**: 이 페르소나가 바라는 개선 한 가지

마지막에 [공통 발견 사항]으로, 여러 페르소나에서 반복적으로 나타난
핵심 사용성 이슈 2~3가지를 요약하세요.
1인칭으로 생생하게, 실제 사용자처럼 솔직하게 작성하세요.`,
  },

  "toss-evaluator": {
    label: "Agent E: Toss Evaluator",
    emoji: "⚖️",
    role: "기획 검증자 / 토스 기준 평가자",
    why: `
**왜 이 에이전트가 필요한가?**

세 에이전트가 각자의 관점에서 작업했다면, 마지막으로 
토스가 실제로 평가하는 3가지 기준에 비춰 전체를 검증해야 합니다.
이 단계 없이 제출하면 좋은 아이디어도 평가 기준을 빗나갈 수 있어요.

이 에이전트는 실제 팀에서 리드 디자이너나 PM이 
최종 발표 전 "토스 기준으로 이게 통과할 수 있나?" 냉정하게 
체크하는 역할이에요. 통과 여부뿐 아니라 보완점도 짚어줍니다.
    `,
    systemPrompt: `당신은 토스(Toss)의 리드 디자이너입니다.
제출된 기획을 토스의 3가지 평가 기준으로 엄격하게 검증하는 전문가입니다.

앞선 에이전트들의 결과물 전체를 검토하여:
1. **본질적인 문제 정의** — 표면적 현상이 아닌 심리적/행동적 허들을 제대로 짚었는가? (Pass/Fail + 근거)
2. **가설 기반의 솔루션 설계** — "~게 보여주면 ~게 인지하여 ~게 행동할 것" 구조가 명확한가? (Pass/Fail + 근거)
3. **조형적 완성도와 디테일** — 이 과제의 특수 맥락에 맞게 픽셀 단위로 정교한가? (Pass/Fail + 근거)

각 기준에 대해 점수(10점 만점)와 구체적인 보완 제안을 함께 제시하세요.
마지막으로 이 기획의 최종 강점 2가지와 개선 필요 사항 2가지를 정리하세요.`,
  },
};

// ────────────────────────────────────────────
// 에이전트 실행 함수
// ────────────────────────────────────────────
async function runAgent(agentKey, previousResults = "") {
  const agent = AGENTS[agentKey];
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${agent.emoji} ${agent.label} 실행 중...`);
  console.log(`${"─".repeat(50)}`);

  const userMessage =
    agentKey === "toss-evaluator"
      ? `다음은 앞선 에이전트들의 결과물입니다(문제정의·UX설계·시각검증·실사용자 QA):\n\n${previousResults}\n\n위 내용을 토스의 3가지 평가 기준으로 검증해주세요. 특히 실사용자 QA에서 드러난 사용성 이슈가 솔루션 가설을 얼마나 뒷받침/반박하는지 반영하세요.`
      : `${TASK_CONTEXT}\n\n${
          previousResults
            ? `앞선 에이전트 결과:\n${previousResults}\n\n위 내용을 참고하여 `
            : ""
        }당신의 역할에 맞게 분석하고 설계해주세요.`;

  const startTime = Date.now();

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2000,
    system: agent.systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const totalTokens = inputTokens + outputTokens;

  console.log(`✅ 완료 (${elapsed}s) | 토큰: 입력 ${inputTokens} + 출력 ${outputTokens} = ${totalTokens}`);

  return {
    agentKey,
    agent,
    content: response.content[0].text,
    tokens: { input: inputTokens, output: outputTokens, total: totalTokens },
    elapsed,
  };
}

// ────────────────────────────────────────────
// MD 리포트 생성
// ────────────────────────────────────────────
function generateReport(results, totalTokens) {
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  let md = `# 🏢 토스 기획 과제 — 에이전트 팀 회의록
> 생성일시: ${now}

---

## 📐 에이전트 구조 설계 의도

이 하네스는 **5개 에이전트**로 구성됩니다.
5개로 나눈 이유는 토스의 기획 평가가 요구하는 사고의 단계를 그대로 분업화했기 때문입니다.

| 순서 | 에이전트 | 역할 | 실제 팀에서의 비유 |
|------|---------|------|-----------------|
| 1 | Problem Framer | 본질 문제 정의 | UX 리서처 (킥오프 미팅) |
| 2 | UX Designer | 플로우 & 화면 설계 | 프로덕트 디자이너 (화이트보드 세션) |
| 3 | Visual Critic | UI 디테일 검증 | UI 스페셜리스트 (디자인 리뷰) |
| 4 | User QA Panel | 실사용자 페르소나 검증 | 6명 동료 빙의 사용성 테스트 |
| 5 | Toss Evaluator | 평가 기준 충족 검증 | 리드 디자이너 (최종 게이트 리뷰) |

> **왜 5개인가?** 토스의 평가 기준 자체가 문제 → 해결 → 시각화 → 사용자검증 → 평가의 5단계 사고를 요구합니다.
> 하나의 에이전트가 전부 하면 각 단계의 깊이가 얕아지고, 
> 각자의 "역할 페르소나"가 명확할수록 더 날카로운 관점이 나옵니다.

---

## 🗓️ 회의 진행 순서 및 결과

`;

  for (const result of results) {
    const { agent, content, tokens, elapsed } = result;

    md += `---

## ${agent.emoji} ${agent.label}
**역할:** ${agent.role} | **소요시간:** ${elapsed}s | **토큰:** ${tokens.total.toLocaleString()} (입력 ${tokens.input.toLocaleString()} + 출력 ${tokens.output.toLocaleString()})

${agent.why}

### 📝 에이전트 발언 내용

${content}

`;
  }

  // 토큰 사용량 요약
  md += `---

## 📊 이번 회의 토큰 사용량 요약

| 에이전트 | 입력 토큰 | 출력 토큰 | 합계 |
|---------|---------|---------|------|
`;

  for (const result of results) {
    md += `| ${result.agent.emoji} ${result.agent.label} | ${result.tokens.input.toLocaleString()} | ${result.tokens.output.toLocaleString()} | **${result.tokens.total.toLocaleString()}** |\n`;
  }

  md += `| **총합** | **${results.reduce((s, r) => s + r.tokens.input, 0).toLocaleString()}** | **${results.reduce((s, r) => s + r.tokens.output, 0).toLocaleString()}** | **${totalTokens.toLocaleString()}** |

> 💡 **Claude Haiku 4.5 기준 예상 비용**
> - 입력: $1 / 1M tokens
> - 출력: $5 / 1M tokens
> - 이번 회의 예상 비용: **$${((results.reduce((s, r) => s + r.tokens.input, 0) / 1_000_000) * 1 + (results.reduce((s, r) => s + r.tokens.output, 0) / 1_000_000) * 5).toFixed(4)}**

---

*Generated by Toss Planning Harness — Multi-Agent System*
`;

  return md;
}

// ────────────────────────────────────────────
// 메인 실행
// ────────────────────────────────────────────
async function main() {
  console.log("🚀 토스 기획 과제 에이전트 팀 회의 시작");
  console.log("=".repeat(50));

  const results = [];
  let previousResults = "";

  const agentOrder = ["problem-framer", "ux-designer", "visual-critic", "user-qa", "toss-evaluator"];

  for (const agentKey of agentOrder) {
    const result = await runAgent(agentKey, previousResults);
    results.push(result);

    // 다음 에이전트에게 누적 컨텍스트 전달
    previousResults += `\n\n### ${result.agent.label} 결과:\n${result.content}`;
  }

  const totalTokens = results.reduce((s, r) => s + r.tokens.total, 0);

  console.log("\n" + "=".repeat(50));
  console.log(`📊 전체 토큰 사용량: ${totalTokens.toLocaleString()}`);
  console.log("=".repeat(50));

  // MD 파일 저장
  const report = generateReport(results, totalTokens);
  const filename = `toss-meeting-${Date.now()}.md`;
  fs.writeFileSync(`./${filename}`, report, "utf-8");
  console.log(`\n✅ 회의록 저장 완료: ${filename}`);

  return { filename, report };
}

const { filename, report } = await main();
export { filename, report };
