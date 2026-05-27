const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = 'netlify/data/library-catalog-filtered.json';
const DEFAULT_OUTPUT = DEFAULT_INPUT;
const DEFAULT_SUMMARY = 'netlify/data/library-catalog-selection-summary.json';
const DEFAULT_LIMIT = 15000;

const CATEGORY_ORDER = [
  'self_development',
  'psychology',
  'essay',
  'economy_business',
  'science',
  'humanities_philosophy',
  'novel',
  'any',
];

const CATEGORY_QUOTAS = {
  novel: 2600,
  essay: 1800,
  self_development: 1600,
  humanities_philosophy: 2400,
  psychology: 1700,
  economy_business: 1900,
  science: 2200,
  any: 800,
};

const CATEGORY_DEFINITIONS = {
  novel: {
    label: '소설',
    terms: [
      '소설', '장편', '단편', '소설집', '문학', '세계문학', '한국문학', '영미문학',
      '작가', '서사', '이야기', '희곡', '시집', '시선집', '판타지', 'sf', '과학소설',
      '추리', '스릴러', '로맨스',
    ],
    callScore(number) {
      return number >= 800 && number < 900 ? 18 : 0;
    },
  },
  essay: {
    label: '에세이',
    terms: [
      '에세이', '산문', '수필', '문장', '일상', '편지', '기록', '사색', '생각',
      '마음', '위로', '삶', '나를', '오늘', '하루',
    ],
    callScore(number) {
      return number >= 800 && number < 900 ? 10 : 0;
    },
  },
  self_development: {
    label: '자기계발',
    terms: [
      '자기계발', '자기개발', '성공', '습관', '몰입', '목표', '성장', '실천',
      '태도', '동기부여', '시간관리', '커리어', '리더십', '멘토', '기획', '일 잘',
      '역량', '도전', '공부법', '말하기', '대화법',
    ],
    callScore(number) {
      if (number >= 150 && number < 160) return 9;
      if (number >= 650 && number < 660) return 7;
      return 0;
    },
  },
  humanities_philosophy: {
    label: '인문·철학',
    terms: [
      '인문', '철학', '사유', '사상', '윤리', '존재', '고전', '문명', '교양',
      '질문', '종교', '신화', '동양철학', '서양철학', '니체', '칸트', '플라톤',
      '아리스토텔레스', '공자', '노자',
    ],
    callScore(number) {
      if (number >= 100 && number < 200) return 18;
      if (number >= 200 && number < 300) return 11;
      if (number >= 900 && number < 1000) return 8;
      return 0;
    },
  },
  psychology: {
    label: '심리',
    terms: [
      '심리', '마음', '감정', '관계', '불안', '자존감', '우울', '상담',
      '정신분석', '행동', '성격', '무의식', '트라우마', '애착', '공감', '뇌',
    ],
    callScore(number) {
      return number >= 150 && number < 160 ? 20 : 0;
    },
  },
  economy_business: {
    label: '경제·경영',
    terms: [
      '경제', '경영', '투자', '시장', '돈', '자본', '비즈니스', '마케팅',
      '브랜드', '창업', '금융', '재테크', '주식', '부동산', '리더', '조직',
      '전략', '회사', '기업', '트렌드',
    ],
    callScore(number) {
      if (number >= 330 && number < 340) return 22;
      if (number >= 650 && number < 660) return 18;
      return 0;
    },
  },
  science: {
    label: '과학',
    terms: [
      '과학', '물리', '화학', '생명', '우주', '수학', '뇌과학', '기술', '진화',
      '환경', '기후', '지구', '천문', '의학', '인공지능', 'ai', '데이터',
      '공학', '생물', '바이러스', '유전자', '로봇',
    ],
    callScore(number) {
      if (number >= 500 && number < 600) return 22;
      if (number >= 600 && number < 650) return 13;
      if (number >= 660 && number < 700) return 13;
      return 0;
    },
  },
};

const GENERAL_TERMS = [
  '교양', '처음', '입문', '읽는', '이야기', '비밀', '세계', '사람', '삶',
  '세상', '하루', '좋은', '모든', '지식', '수업', '산책', '생각', '재미',
];

const HARD_EXCLUDE_PATTERNS = [
  /비디오\s*녹화자료|전자자료|컴퓨터파일|cd-rom|dvd|vhs/i,
  /수험|문제집|기출|모의고사|국가고시|공무원|자격증|토익|toeic|토플|toefl|jlpt|hsk/i,
  /만화|漫画|comic|manga|cartoon/i,
  /전공서|전공책|대학교재|강의교재|실습서|워크북|manual|매뉴얼/i,
  /민속지|민속\s*조사|민속조사보고서|경기민속지/i,
  /조사보고서|연구보고서|결과보고서|최종보고서|중간보고서|실태조사|현황조사/i,
  /통계연보|백서|자료집|논문집|학술대회|회의록|색인|목록|편람/i,
  /발굴조사|문화유적|문화재\s*조사|지표조사|향토지|군지|읍지|면지|시지/i,
];

const SOFT_PENALTY_PATTERNS = [
  /연구|조사|자료|보고|총서|전집|全集|선집|도록|사전|용어|해설서/i,
  /개론|원론|각론|총론|기초|실무|방법론|세미나|강의/i,
  /\bvol\.?\s*\d+|\bv\.?\s*\d+|제\s*\d+\s*권|=\s*\d+\s*$/i,
];

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    summary: DEFAULT_SUMMARY,
    limit: DEFAULT_LIMIT,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input') {
      args.input = next;
      index += 1;
    } else if (arg === '--output') {
      args.output = next;
      index += 1;
    } else if (arg === '--summary') {
      args.summary = next;
      index += 1;
    } else if (arg === '--limit') {
      args.limit = Number(next);
      index += 1;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    throw new Error('--limit must be a positive number');
  }

  return args;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function normalized(value) {
  return text(value).normalize('NFKC').toLowerCase();
}

function compactTitle(value) {
  return normalized(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function hasHangul(value) {
  return /[가-힣]/.test(text(value));
}

function extractYear(value) {
  const match = text(value).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}

function extractCallNumber(value) {
  const match = text(value).match(/(?:^|[^0-9])([0-9]{1,3})(?:\.[0-9]+)?/);
  if (!match) return 0;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : 0;
}

function includesTerm(source, term) {
  return source.includes(term.toLowerCase());
}

function countTerms(source, terms) {
  let count = 0;
  for (const term of terms) {
    if (includesTerm(source, term)) count += 1;
  }
  return count;
}

function stableJitter(value) {
  const source = normalized(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function isHardExcluded(row) {
  const fullText = normalized([
    row.title,
    row.author,
    row.callNo,
    row.year,
    row.location,
  ].map(text).join(' '));
  return HARD_EXCLUDE_PATTERNS.some(pattern => pattern.test(fullText));
}

function qualityScore(row) {
  const title = text(row.title);
  const normalizedTitle = normalized(title);
  const titleLength = [...title].length;
  const year = Math.max(extractYear(row.year), extractYear(row.shelvedAt));
  const callNumber = extractCallNumber(row.callNo);
  let score = 0;

  score += hasHangul(title) ? 18 : -18;
  if (titleLength >= 4 && titleLength <= 38) score += 10;
  else if (titleLength <= 60) score += 4;
  else score -= 10;

  if (year >= 2020) score += 18;
  else if (year >= 2015) score += 15;
  else if (year >= 2010) score += 12;
  else if (year >= 2000) score += 8;
  else if (year >= 1990) score += 4;
  else if (year > 0) score -= 2;

  if (text(row.author)) score += 3;
  if (text(row.callNo)) score += 4;
  if (callNumber > 0) score += 3;

  score += Math.min(countTerms(normalizedTitle, GENERAL_TERMS), 3) * 4;

  for (const pattern of SOFT_PENALTY_PATTERNS) {
    if (pattern.test(normalizedTitle)) score -= 8;
  }

  if (/상|하|上|下|전\s*\d+권|세트/i.test(normalizedTitle)) score -= 4;
  if (/개정|증보|新版|신판/i.test(normalizedTitle)) score += 2;

  return score;
}

function categoryScore(row, categoryId) {
  const definition = CATEGORY_DEFINITIONS[categoryId];
  if (!definition) return 0;

  const title = normalized(row.title);
  const fullText = normalized([
    row.title,
    row.author,
    row.callNo,
    row.year,
  ].map(text).join(' '));
  const callNumber = extractCallNumber(row.callNo);

  let score = definition.callScore(callNumber);
  for (const term of definition.terms) {
    const lowerTerm = term.toLowerCase();
    if (title.includes(lowerTerm)) score += 14;
    else if (fullText.includes(lowerTerm)) score += 7;
  }

  return score;
}

function rankedForCategory(candidates, categoryId) {
  return candidates
    .map(candidate => {
      const score = categoryScore(candidate.row, categoryId);
      return {
        ...candidate,
        categoryId,
        categoryScore: score,
        totalScore: candidate.qualityScore + score + stableJitter(`${categoryId}:${candidate.key}`),
      };
    })
    .filter(candidate => candidate.categoryScore >= 14)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.key.localeCompare(b.key, 'ko');
    });
}

function rankedAny(candidates) {
  return candidates
    .map(candidate => ({
      ...candidate,
      categoryId: 'any',
      categoryScore: 0,
      totalScore: candidate.qualityScore + stableJitter(`any:${candidate.key}`),
    }))
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.key.localeCompare(b.key, 'ko');
    });
}

function chooseCandidates(rows, limit) {
  const deduped = new Map();
  let hardExcluded = 0;
  let duplicateTitles = 0;

  for (const row of rows) {
    const key = compactTitle(row.title);
    if (!key) continue;
    if (isHardExcluded(row)) {
      hardExcluded += 1;
      continue;
    }

    const candidate = {
      key,
      row,
      qualityScore: qualityScore(row),
    };

    const current = deduped.get(key);
    if (!current || candidate.qualityScore > current.qualityScore) {
      deduped.set(key, candidate);
    } else {
      duplicateTitles += 1;
    }
  }

  const candidates = [...deduped.values()];
  const selectedByKey = new Map();
  const selectedByCategory = Object.fromEntries(CATEGORY_ORDER.map(id => [id, []]));
  const availability = {};

  for (const categoryId of CATEGORY_ORDER.filter(id => id !== 'any')) {
    const ranked = rankedForCategory(candidates, categoryId);
    availability[categoryId] = ranked.length;
    const quota = CATEGORY_QUOTAS[categoryId] || 0;
    for (const candidate of ranked) {
      if (selectedByKey.size >= limit) break;
      if (selectedByCategory[categoryId].length >= quota) break;
      if (selectedByKey.has(candidate.key)) continue;
      selectedByKey.set(candidate.key, candidate);
      selectedByCategory[categoryId].push(candidate);
    }
  }

  const anyQuota = CATEGORY_QUOTAS.any || 0;
  for (const candidate of rankedAny(candidates)) {
    if (selectedByKey.size >= limit) break;
    if (selectedByCategory.any.length >= anyQuota && selectedByKey.size >= Math.min(limit, Object.values(CATEGORY_QUOTAS).reduce((sum, quota) => sum + quota, 0))) {
      break;
    }
    if (selectedByKey.has(candidate.key)) continue;
    selectedByKey.set(candidate.key, candidate);
    selectedByCategory.any.push(candidate);
  }

  if (selectedByKey.size < limit) {
    for (const candidate of rankedAny(candidates)) {
      if (selectedByKey.size >= limit) break;
      if (selectedByKey.has(candidate.key)) continue;
      selectedByKey.set(candidate.key, candidate);
      selectedByCategory.any.push(candidate);
    }
  }

  const interleaved = [];
  let didAdd = true;
  while (didAdd && interleaved.length < limit) {
    didAdd = false;
    for (const categoryId of CATEGORY_ORDER) {
      const next = selectedByCategory[categoryId].shift();
      if (!next) continue;
      interleaved.push(next);
      didAdd = true;
      if (interleaved.length >= limit) break;
    }
  }

  const categoryCounts = {};
  for (const candidate of interleaved) {
    categoryCounts[candidate.categoryId] = (categoryCounts[candidate.categoryId] || 0) + 1;
  }

  return {
    selected: interleaved.map(candidate => candidate.row),
    summary: {
      sourceCount: rows.length,
      dedupedTitleCount: candidates.length,
      hardExcluded,
      duplicateTitles,
      limit,
      selectedCount: interleaved.length,
      categoryCounts,
      availability,
      quotas: CATEGORY_QUOTAS,
      categoryLabels: {
        any: '아무거나(AI추천)',
        ...Object.fromEntries(Object.entries(CATEGORY_DEFINITIONS).map(([id, definition]) => [id, definition.label])),
      },
      samples: interleaved.slice(0, 20).map(candidate => ({
        category: candidate.categoryId,
        title: candidate.row.title,
        author: candidate.row.author,
        year: candidate.row.year,
      })),
    },
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const rows = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new Error(`${args.input} must contain a JSON array`);
  }

  const { selected, summary } = chooseCandidates(rows, args.limit);
  writeJson(args.output, selected);
  writeJson(args.summary, summary);

  console.log(JSON.stringify({
    input: args.input,
    output: args.output,
    summary: args.summary,
    sourceCount: summary.sourceCount,
    selectedCount: summary.selectedCount,
    categoryCounts: summary.categoryCounts,
  }, null, 2));
}

main();
