(function(){
  const originalFetch = window.fetch.bind(window);
  const DATA_BASE = new URL('data/', document.baseURI);
  const caches = new Map();
  const SHARED_RESULTS_KEY = 'donga-ai-book-finder:shared-results';
  const SHARED_RESULTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const CATEGORY_FILTERS = {
    any: { tags: [], keywords: [] },
    novel: {
      tags: ['novel', 'literature', 'story', 'mystery', 'classic'],
      keywords: ['소설', '문학', '장르', '미스터리', '추리', '로맨스', '판타지', 'SF']
    },
    essay: {
      tags: ['essay', 'life', 'mind', 'comfort', 'healing'],
      keywords: ['에세이', '산문', '마음', '일상', '위로']
    },
    self_development: {
      tags: ['growth', 'career', 'practical', 'work', 'challenge', 'identity'],
      keywords: ['자기계발', '성공', '리더십', '습관', '커리어', '취업', '실용']
    },
    humanities_philosophy: {
      tags: ['humanities', 'philosophy', 'history', 'deep', 'society', 'classic'],
      keywords: ['인문', '철학', '역사', '고전', '사상', '문명', '사회']
    },
    psychology: {
      tags: ['psychology', 'mind', 'relationship', 'comfort', 'healing'],
      keywords: ['심리', '마음', '감정', '관계', '정신']
    },
    economy_business: {
      tags: ['economy', 'business', 'work', 'practical', 'career'],
      keywords: ['경제', '경영', '투자', '마케팅', '비즈니스', '금융', '시장']
    },
    science: {
      tags: ['science', 'technology', 'future', 'knowledge'],
      keywords: ['과학', '기술', 'AI', '인공지능', '우주', '수학']
    },
    society: {
      tags: ['society', 'history', 'humanities', 'knowledge'],
      keywords: ['사회', '정치', '문화', '제도', '젠더']
    },
    art_culture: {
      tags: ['art', 'culture', 'literature'],
      keywords: ['예술', '문화', '미술', '음악', '영화', '디자인']
    },
    travel_hobby: {
      tags: ['travel', 'life', 'fun', 'art'],
      keywords: ['여행', '취미', '요리', '공간']
    }
  };

  const TAG_LABELS = {
    easy: '부담 없이 읽기',
    comfort: '위로',
    healing: '회복',
    knowledge: '지식',
    science: '과학',
    society: '사회',
    novel: '문학',
    essay: '에세이',
    career: '일과 진로',
    youth: '청춘과 진로',
    start: '처음 시작',
    study: '공부와 학습',
    economy: '경제',
    business: '경영',
    identity: '나를 찾기',
    balanced: '균형 있는 선택',
    deep: '깊은 사유',
    classic: '고전',
    technology: '기술과 미래',
    future: '미래 감각',
    relationship: '관계',
    growth: '성장',
    challenge: '도전',
    art: '예술',
    culture: '문화',
    history: '역사',
    humanities: '인문',
    literature: '문학',
    story: '이야기',
    mystery: '미스터리',
    mind: '마음 탐색',
    philosophy: '철학',
    practical: '실용',
    travel: '여행',
    life: '삶의 태도',
    fun: '즐거운 읽기',
    work: '일과 작업',
    short: '짧게 읽기',
    psychology: '심리',
    popular: '동아인의 선택',
    readable: '잘 읽히는 책',
    new: '신착도서',
    fresh: '새로운 책',
    recommended: '추천도서'
  };

  function apiResponse(status, body, cacheControl = 'no-store'){
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': cacheControl
      }
    });
  }

  function requestUrl(input){
    const value = typeof input === 'string' ? input : input && input.url;
    if(!value) return null;
    try{
      return new URL(value, window.location.origin);
    }catch(_){
      return null;
    }
  }

  function apiName(input){
    const url = requestUrl(input);
    if(!url) return '';
    const match = url.pathname.match(/\/\.netlify\/functions\/([^/?#]+)$/);
    return match ? match[1] : '';
  }

  async function loadJson(name){
    if(!caches.has(name)){
      const url = new URL(name, DATA_BASE);
      caches.set(name, originalFetch(url.toString(), { headers:{ accept:'application/json' } })
        .then(res=>{
          if(!res.ok) throw new Error(`${name} 파일을 불러오지 못했습니다.`);
          return res.json();
        }));
    }
    return caches.get(name);
  }

  function clone(value){
    return JSON.parse(JSON.stringify(value));
  }

  function validQuestion(question){
    return question
      && typeof question.id === 'string'
      && typeof question.title === 'string'
      && Array.isArray(question.choices)
      && question.choices.length > 1;
  }

  function randomId(){
    if(window.crypto && window.crypto.getRandomValues){
      const bytes = new Uint8Array(12);
      window.crypto.getRandomValues(bytes);
      return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 16);
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function shuffled(items, seed = randomId()){
    return [...items]
      .map((item, index)=>({ item, sort:stableFloat(seed, index, item && item.id || item && item.isbn || '') }))
      .sort((a,b)=>a.sort - b.sort)
      .map(({ item })=>item);
  }

  async function handleQuestions(input){
    const url = requestUrl(input);
    const limit = Math.min(10, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '5', 10) || 5));
    const questions = (await loadJson('questions.json')).filter(validQuestion);
    const seed = randomId();
    return apiResponse(200, {
      version: 'static-questions-v1',
      limit,
      total: questions.length,
      questions: shuffled(questions, seed).slice(0, limit).map(clone),
      seed
    }, 'public, max-age=300');
  }

  function cleanText(value){
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeIsbn(value){
    const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    return isbn.length === 10 || isbn.length === 13 ? isbn : '';
  }

  function stableFloat(...parts){
    const text = parts.join(':');
    let hash = 2166136261;
    for(let i = 0; i < text.length; i += 1){
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
  }

  function answerTags(answers){
    const counts = new Map();
    (answers || []).forEach(answer=>{
      const tags = answer && answer.choice && Array.isArray(answer.choice.tags) ? answer.choice.tags : [];
      tags.forEach(tag=>{
        const key = String(tag || '').trim();
        if(key) counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a,b)=>b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag])=>tag);
  }

  function entryText(entry){
    return cleanText([
      entry && entry.title,
      entry && entry.author,
      entry && entry.publisher,
      entry && entry.collection,
      entry && Array.isArray(entry.meta) ? entry.meta.join(' ') : '',
      entry && entry.aladin && entry.aladin.categoryName
    ].join(' '));
  }

  function firstPublisher(entry){
    const meta = Array.isArray(entry && entry.meta) ? entry.meta : [];
    const value = meta.find(item=>/\d{4}/.test(String(item || ''))) || meta[0] || '';
    return cleanText(value).replace(/\s+\d{4}.*/, '');
  }

  function isExamPrepBook(entry){
    return /수험|문제|기출|모의고사|공무원|자격증|토익|TOEIC|토플|TOEFL|JLPT|편입|PSAT|LEET|수능|고시|교재/.test(entryText(entry));
  }

  function categoryFromRequest(payload, answers){
    const direct = payload && payload.categoryFilter && payload.categoryFilter.id;
    if(direct && direct !== 'any') return String(direct);
    const categoryAnswer = (answers || []).find(answer=>answer && answer.questionId === 'preferred_category');
    const fromChoice = categoryAnswer && categoryAnswer.choice && categoryAnswer.choice.categoryFilter && categoryAnswer.choice.categoryFilter.id;
    return fromChoice && fromChoice !== 'any' ? String(fromChoice) : 'any';
  }

  function categoryMatch(entry, categoryId){
    if(!categoryId || categoryId === 'any') return { matched:true, score:0 };
    const filter = CATEGORY_FILTERS[categoryId] || CATEGORY_FILTERS.any;
    const tags = new Set([...(entry.collectionTags || []), ...(entry.collectionKeys || [])].map(String));
    const text = entryText(entry).toLowerCase();
    const tagHits = filter.tags.filter(tag=>tags.has(tag)).length;
    const keywordHits = filter.keywords.filter(keyword=>text.includes(keyword.toLowerCase())).length;
    return {
      matched: tagHits > 0 || keywordHits > 0,
      score: tagHits * 12 + keywordHits * 10
    };
  }

  function descriptionForEntry(entry, descriptions){
    const isbn = normalizeIsbn(entry && entry.isbn);
    const found = isbn ? descriptions.get(isbn) : null;
    return cleanText(
      entry && entry.description
      || entry && entry.aladin && entry.aladin.description
      || found && found.description
    );
  }

  function scoreEntry(entry, tags, categoryId, seed, excludeSet, descriptions = new Map()){
    const isbn = normalizeIsbn(entry && entry.isbn);
    if(!entry || !isbn || excludeSet.has(isbn) || isExamPrepBook(entry)) return null;
    const entryTags = new Set([...(entry.collectionTags || []), ...(entry.collectionKeys || [])].map(String));
    const text = entryText(entry).toLowerCase();
    const matched = [];
    let score = 0;

    tags.forEach((tag, index)=>{
      const key = String(tag || '');
      const directHit = entryTags.has(key);
      const textHit = key && text.includes(key.toLowerCase());
      if(directHit || textHit){
        matched.push(key);
        score += Math.max(4, 16 - index * 1.6);
      }
    });

    const category = categoryMatch(entry, categoryId);
    score += category.score + (categoryId !== 'any' && category.matched ? 18 : 0);
    if(categoryId !== 'any' && !category.matched) score -= 14;
    if((entry.collectionKeys || []).includes('popular')) score += 8;
    if((entry.collectionKeys || []).includes('new')) score += 5;
    if(entry.cover || (entry.aladin && entry.aladin.cover)) score += 4;
    if(entry.aladin && entry.aladin.link) score += 3;
    const description = descriptionForEntry(entry, descriptions);
    if(description) score += 30;
    score += stableFloat(seed, isbn, tags.join(',')) * 6;

    return { entry, isbn, score, matched, categoryMatched:category.matched, description };
  }

  function bookFromEntry(scored, fallbackTags){
    const entry = scored.entry;
    const aladin = entry.aladin || {};
    const matchedTags = (scored.matched.length ? scored.matched : fallbackTags)
      .map(tag=>TAG_LABELS[tag] || tag)
      .filter(Boolean)
      .slice(0, 4);
    const meta = Array.isArray(entry.meta) ? entry.meta : [];
    return {
      title: cleanText(entry.title) || '제목 정보 없음',
      author: cleanText(entry.author),
      publisher: cleanText(entry.publisher || aladin.publisher || firstPublisher(entry)),
      description: scored.description || makeDescription(entry, matchedTags),
      cover: cleanText(entry.cover || aladin.cover),
      coverFallbacks: [entry.cover, aladin.cover].filter(Boolean),
      link: cleanText(aladin.link),
      isbn: scored.isbn,
      categoryName: cleanText(aladin.categoryName),
      categoryMatched: scored.categoryMatched,
      collection: cleanText(entry.collection || '도서관 소장자료'),
      collectionKeys: entry.collectionKeys || [],
      libraryCatalogUrl: cleanText(entry.catalogUrl || entry.libraryCatalogUrl),
      matchedTags,
      score: scored.score
    };
  }

  function makeDescription(entry, matchedTags){
    const topic = matchedTags && matchedTags.length ? `${matchedTags.join(', ')} 흐름과 잘 맞는` : '선택한 답변과 잘 맞는';
    const author = cleanText(entry.author);
    const collection = cleanText(entry.collection || '도서관 소장자료');
    return `${topic} ${collection}입니다.${author ? ` ${author}의 책으로,` : ''} 도서관 소장 정보와 함께 바로 확인할 수 있습니다.`;
  }

  function topicKey(book){
    return (book.matchedTags && book.matchedTags[0]) || (book.collectionKeys && book.collectionKeys[0]) || '';
  }

  function chooseDiverse(scoredItems, limit, fallbackTags){
    const selected = [];
    const remaining = [...scoredItems].sort((a,b)=>b.score - a.score);
    while(selected.length < limit && remaining.length){
      let pickIndex = 0;
      let bestAdjusted = -Infinity;
      remaining.slice(0, 40).forEach((candidate, index)=>{
        const book = bookFromEntry(candidate, fallbackTags);
        const sameAuthor = selected.some(item=>item.author && item.author === book.author);
        const sameTopicCount = selected.filter(item=>topicKey(item) === topicKey(book)).length;
        const penalty = (sameAuthor ? 12 : 0) + sameTopicCount * 4;
        const adjusted = candidate.score - penalty;
        if(adjusted > bestAdjusted){
          bestAdjusted = adjusted;
          pickIndex = index;
        }
      });
      selected.push(bookFromEntry(remaining[pickIndex], fallbackTags));
      remaining.splice(pickIndex, 1);
    }
    return selected;
  }

  function shelfTitle(tags, categoryId){
    if(categoryId && categoryId !== 'any'){
      const labels = {
        novel: '이야기 안쪽으로 들어가는 책',
        essay: '마음의 속도를 맞춰주는 책',
        self_development: '다시 움직이게 하는 책',
        humanities_philosophy: '오래 생각을 붙드는 책',
        psychology: '마음을 이해하는 책',
        economy_business: '일과 세상을 읽는 책',
        science: '미래 감각을 여는 책',
        society: '세상의 흐름을 읽는 책',
        art_culture: '감각을 깨우는 책',
        travel_hobby: '일상을 환기하는 책'
      };
      if(labels[categoryId]) return labels[categoryId];
    }
    if(tags.some(tag=>['technology', 'future', 'science'].includes(tag))) return '미래 감각을 여는 책';
    if(tags.some(tag=>['comfort', 'healing', 'mind', 'psychology'].includes(tag))) return '마음을 천천히 회복하는 책';
    if(tags.some(tag=>['career', 'growth', 'work', 'practical'].includes(tag))) return '다시 움직이게 하는 책';
    if(tags.some(tag=>['novel', 'story', 'literature', 'mystery'].includes(tag))) return '이야기 안쪽으로 들어가는 책';
    return '오늘의 관심사와 맞닿은 책';
  }

  function resultStore(){
    try{
      return JSON.parse(localStorage.getItem(SHARED_RESULTS_KEY) || '{}') || {};
    }catch(_){
      return {};
    }
  }

  function saveResult(result){
    const id = randomId();
    const now = Date.now();
    const store = resultStore();
    Object.keys(store).forEach(key=>{
      if(Date.parse(store[key] && store[key].expiresAt || '') <= now) delete store[key];
    });
    store[id] = {
      id,
      createdAt:new Date(now).toISOString(),
      expiresAt:new Date(now + SHARED_RESULTS_TTL_MS).toISOString(),
      result
    };
    localStorage.setItem(SHARED_RESULTS_KEY, JSON.stringify(store));
    return store[id];
  }

  async function handleSharedResult(input, init){
    const method = String(init && init.method || (input && input.method) || 'GET').toUpperCase();
    if(method === 'POST'){
      const body = JSON.parse((init && init.body) || '{}');
      if(!body.result || !Array.isArray(body.result.items) || !body.result.items.length){
        return apiResponse(400, { error:'추천 결과가 필요합니다.' });
      }
      const saved = saveResult(body.result);
      return apiResponse(200, { id:saved.id, expiresAt:saved.expiresAt });
    }
    const url = requestUrl(input);
    const id = url.searchParams.get('id') || '';
    const saved = resultStore()[id];
    if(!saved) return apiResponse(404, { error:'공유 결과를 찾을 수 없습니다.' });
    if(Date.parse(saved.expiresAt || '') <= Date.now()){
      return apiResponse(410, { error:'공유 결과 보관 기간이 지났습니다.' });
    }
    return apiResponse(200, saved);
  }

  async function handleRecommend(input, init){
    const method = String(init && init.method || (input && input.method) || 'GET').toUpperCase();
    if(method !== 'POST') return apiResponse(405, { error:'Method not allowed' });
    const payload = JSON.parse((init && init.body) || '{}');
    const answers = Array.isArray(payload.answers) ? payload.answers : [];
    const tags = answerTags(answers);
    const categoryId = categoryFromRequest(payload, answers);
    if(!tags.length) return apiResponse(400, { error:'답변이 필요합니다.' });

    const seed = String(payload.seed || randomId());
    const excludeSet = new Set((payload.excludeIsbns || []).map(normalizeIsbn).filter(Boolean));
    const [libraryPool, catalogPool, bestSellerData, descriptionData] = await Promise.all([
      loadJson('library-pool.json'),
      loadJson('library-catalog-pool.json').catch(()=>[]),
      loadJson('aladin-bestsellers.json').catch(()=>({ items:[] })),
      loadJson('aladin-descriptions.json').catch(()=>({ items:[] }))
    ]);
    const descriptions = new Map((Array.isArray(descriptionData && descriptionData.items) ? descriptionData.items : [])
      .map(item=>[normalizeIsbn(item && item.isbn), item])
      .filter(([isbn, item])=>isbn && item && item.description));
    const source = [...libraryPool, ...catalogPool];
    const seen = new Set();
    const scored = source
      .map(entry=>scoreEntry(entry, tags, categoryId, seed, excludeSet, descriptions))
      .filter(Boolean)
      .filter(item=>{
        if(seen.has(item.isbn)) return false;
        seen.add(item.isbn);
        return true;
      });

    const limit = Math.min(10, Math.max(3, Number.parseInt(payload.limit || '6', 10) || 6));
    const popularLimit = Math.min(8, Math.max(3, Number.parseInt(payload.popularLimit || '5', 10) || 5));
    const categoryPreferred = categoryId === 'any' ? scored : scored.filter(item=>item.categoryMatched);
    const mainSource = categoryPreferred.length >= limit ? categoryPreferred : scored;
    const describedMainSource = mainSource.filter(item=>item.description);
    const describedFallbackSource = scored.filter(item=>item.description && !describedMainSource.some(candidate=>candidate.isbn === item.isbn));
    const recommendationSource = describedMainSource.length >= limit
      ? describedMainSource
      : [...describedMainSource, ...describedFallbackSource, ...mainSource];
    const items = chooseDiverse(recommendationSource, limit, tags);
    const itemIsbns = new Set(items.map(item=>item.isbn));
    const popularScored = scored
      .filter(item=>!itemIsbns.has(item.isbn))
      .map(item=>({
        ...item,
        score:item.score
          + ((item.entry.collectionKeys || []).includes('popular') ? 22 : 0)
          + ((item.entry.collectionTags || []).includes('readable') ? 8 : 0)
      }))
      .sort((a,b)=>b.score - a.score);
    const popularItems = chooseDiverse(popularScored, popularLimit, ['popular', 'readable'])
      .map(item=>({ ...item, matchedTags:['동아인의 선택', '인기도서'] }));
    const cachedBestSellers = Array.isArray(bestSellerData && bestSellerData.items) ? bestSellerData.items : [];
    const fallbackBestSellers = source
      .filter(entry=>entry && entry.aladin && entry.aladin.link && !isExamPrepBook(entry))
      .map((entry, index)=>scoreEntry(entry, ['popular', 'readable'], 'any', `${seed}:best:${index}`, new Set(), descriptions))
      .filter(Boolean)
      .sort((a,b)=>b.score - a.score)
      .slice(0, 6)
      .map((item, index)=>({
        ...bookFromEntry(item, ['popular', 'readable']),
        rank:index + 1,
        isOwned:true,
        holdingChecked:true,
        actionLabel:'도서관 소장 확인',
        actionUrl:item.entry.catalogUrl || ''
      }));
    const aladinBestSellers = cachedBestSellers.length
      ? cachedBestSellers.slice(0, 6)
      : fallbackBestSellers;
    const hasAladinData = aladinBestSellers.length > 0 || source.some(entry=>entry && entry.aladin && entry.aladin.link);

    return apiResponse(200, {
      apiVersion:'static-ai-book-finder-v1',
      source: cachedBestSellers.length ? 'GitHub Pages static data + Aladin ItemList snapshot' : 'GitHub Pages static data',
      shelfTitle:shelfTitle(tags, categoryId),
      summary:`답변 ${answers.length}개를 바탕으로 도서관 소장 자료를 분석했습니다.`,
      categoryFilter:payload.categoryFilter || { id:categoryId, label:categoryId === 'any' ? '아무거나(AI추천)' : categoryId },
      poolCount:source.length,
      items,
      popularItems,
      aladinBestSellers,
      seed,
      aladinEnabled:hasAladinData,
      aladinUpdatedAt:bestSellerData && bestSellerData.generatedAt || '',
      aladinDescriptionCount:descriptions.size,
      updatedAt:new Date().toISOString()
    });
  }

  function removeServerOnlyUi(){
    document.querySelectorAll('#emailResultBtn, #emailResultModal').forEach(element=>element.remove());
    document.querySelectorAll('a[href*="instagram.com"], .instagram-section').forEach(element=>{
      if(element.classList && element.classList.contains('instagram-section')) element.remove();
    });
  }

  window.fetch = async function(input, init){
    const signal = init && init.signal;
    if(signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const name = apiName(input);
    try{
      if(name === 'questions') return await handleQuestions(input);
      if(name === 'recommend-books') return await handleRecommend(input, init || {});
      if(name === 'shared-result') return await handleSharedResult(input, init || {});
      if(name === 'email-result'){
        return apiResponse(410, { error:'GitHub Pages 배포에서는 메일 발송 기능을 사용하지 않습니다.' });
      }
      if(name === 'instagram-feed'){
        return apiResponse(410, { error:'Instagram 기능은 사용하지 않습니다.', items:[] });
      }
    }catch(error){
      if(signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return apiResponse(500, { error:error.message || '정적 API 처리 중 오류가 발생했습니다.' });
    }
    return originalFetch(input, init);
  };

  document.addEventListener('DOMContentLoaded', removeServerOnlyUi);
})();
