document.addEventListener('DOMContentLoaded', () => {
  const LIBRARY_CATALOG_URL = 'https://library.donga.ac.kr/resource/library-catalog/';
  const LIBRARY_CATALOG_REST_URL = 'https://library.donga.ac.kr/wp-json/wp/v2/pages/17';
  const PURCHASE_REQUEST_URL = 'https://library.donga.ac.kr/libaray-services/using-materials/purchase-request/#';
  const AURA_CLASSES = [
    'aura-comfort',
    'aura-knowledge',
    'aura-future',
    'aura-story',
    'aura-growth',
    'aura-art',
    'aura-balanced'
  ];
  const CATEGORY_QUESTION_ID = 'preferred_category';
  const ENABLE_CATEGORY_QUESTION = false;
  const FIXED_CATEGORY_QUESTION = {
    id:CATEGORY_QUESTION_ID,
    eyebrow:'추천 범위',
    title:'마지막으로, 어떤 분야의 책을 추천받고 싶나요?',
    help:'',
    layout:'category-grid',
    choices:[
      { id:'any', emoji:'✨', label:'아무거나(AI추천)', desc:'전체 분야', categoryFilter:{ id:'any', label:'아무거나(AI추천)' } },
      { id:'novel', emoji:'📖', label:'소설', desc:'이야기와 문학', categoryFilter:{ id:'novel', label:'소설' } },
      { id:'essay', emoji:'✍️', label:'에세이', desc:'머무는 문장', categoryFilter:{ id:'essay', label:'에세이' } },
      { id:'self_development', emoji:'🚀', label:'자기계발', desc:'성장과 실천', categoryFilter:{ id:'self_development', label:'자기계발' } },
      { id:'humanities_philosophy', emoji:'🧠', label:'인문·철학', desc:'생각과 사유', categoryFilter:{ id:'humanities_philosophy', label:'인문·철학' } },
      { id:'psychology', emoji:'💭', label:'심리', desc:'마음과 관계', categoryFilter:{ id:'psychology', label:'심리' } },
      { id:'economy_business', emoji:'📈', label:'경제·경영', desc:'시장과 일', categoryFilter:{ id:'economy_business', label:'경제·경영' } },
      { id:'science', emoji:'🔬', label:'과학', desc:'지식과 발견', categoryFilter:{ id:'science', label:'과학' } }
    ]
  };

  function collectValues(value){
    if(Array.isArray(value)) return value.flatMap(collectValues);
    if(value && typeof value === 'object') return Object.values(value).flatMap(collectValues);
    return value == null ? [] : [String(value)];
  }

  function auraClassFor(value){
    const text = collectValues(value).join(' ').toLowerCase();
    if(/다가올 세계|미래|technology|future|science|ai|인공지능|기술|과학|우주/.test(text)) return 'aura-future';
    if(/comfort|healing|relationship|mind|psychology|essay|위로|회복|관계|마음|심리|에세이/.test(text)) return 'aura-comfort';
    if(/novel|story|literature|classic|mystery|문학|소설|이야기|고전|시|작가|추리/.test(text)) return 'aura-story';
    if(/career|growth|work|practical|challenge|identity|성장|진로|일과 진로|실용|도전|커리어|일\b/.test(text)) return 'aura-growth';
    if(/art|culture|감각|예술|미술|음악|디자인|창작/.test(text)) return 'aura-art';
    if(/knowledge|society|history|philosophy|humanities|deep|지식|사회|역사|철학|인문|깊은 사유|질문/.test(text)) return 'aura-knowledge';
    return 'aura-balanced';
  }

  function bookAuraClass(book, index = 0){
    const detected = auraClassFor([book && book.matchedTags, book && book.collection, book && book.title]);
    if(detected !== 'aura-balanced') return detected;
    return AURA_CLASSES[index % (AURA_CLASSES.length - 1)];
  }

  function setAuraClass(element, className){
    if(!element) return;
    element.classList.remove(...AURA_CLASSES);
    element.classList.add(className || 'aura-balanced');
  }

  function newSeed(){
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const RECENT_RECOMMENDATIONS_KEY = 'donga-ai-book-finder:recent-recommendations';
  const RECENT_RECOMMENDATIONS_LIMIT = 72;
  const RECENT_RECOMMENDATIONS_TTL = 14 * 24 * 60 * 60 * 1000;

  function recentRecommendationRecords(){
    try{
      const parsed = JSON.parse(localStorage.getItem(RECENT_RECOMMENDATIONS_KEY) || '[]');
      const now = Date.now();
      return Array.isArray(parsed)
        ? parsed
          .filter(item=>item && item.isbn && now - Number(item.savedAt || 0) < RECENT_RECOMMENDATIONS_TTL)
          .slice(0, RECENT_RECOMMENDATIONS_LIMIT)
        : [];
    }catch(_){
      return [];
    }
  }

  function recentRecommendationIsbns(){
    return recentRecommendationRecords().map(item=>item.isbn);
  }

  function rememberRecommendedBooks(items){
    const now = Date.now();
    const fresh = (items || [])
      .map(book=>String(book && book.isbn || '').replace(/[^0-9Xx]/g, '').trim())
      .filter(Boolean)
      .map(isbn=>({ isbn, savedAt:now }));
    if(!fresh.length) return;
    try{
      const merged = [...fresh, ...recentRecommendationRecords()];
      const seen = new Set();
      const compact = merged.filter(item=>{
        if(seen.has(item.isbn)) return false;
        seen.add(item.isbn);
        return true;
      }).slice(0, RECENT_RECOMMENDATIONS_LIMIT);
      localStorage.setItem(RECENT_RECOMMENDATIONS_KEY, JSON.stringify(compact));
    }catch(_){}
  }

  let QUESTIONS = [];
  let sessionSeed = newSeed();
  let questionLoadPromise = null;
  let currentRecommendation = null;
  let activeRecommendationRequestId = 0;
  let recommendationAbortController = null;
  const state = { index:0, answers:{} };
  const TITLE_ACCENT_PHRASES = [
    '필요한 책',
    '어떤 마음',
    '어떤 방향',
    '마지막 장',
    '읽기 속도',
    '한 단어',
    '어떤 문장',
    '어느 시간',
    '가장 중요',
    '책 한 권',
    '문 하나',
    '카페',
    '시험 끝난 날',
    '이어폰',
    '하루의 모드',
    '어떤 분야',
    '어떤 사람',
    '첫 페이지',
    '자판기',
    '내 피드',
    'AI가 초안',
    '알림',
    '작은 의식',
    '폰을 잠깐',
    '미래의 나',
    '도서관',
    '책상 위',
    '이번 주말',
    '공유 결과',
    'AI',
    '마음',
    '방향',
    '날씨',
    '문장',
    '시간',
    '기준',
    '오늘'
  ];
  const RESULT_TITLE_ACCENT_PHRASES = [
    '다가올 세계',
    '잠시 숨',
    '다시 움직이게',
    '오래 생각',
    '이야기 안쪽',
    '오늘의 관심사',
    '공유 결과',
    'AI'
  ];
  const els = {
    startView:document.getElementById('startView'),
    quizView:document.getElementById('quizView'),
    loadingView:document.getElementById('loadingView'),
    resultsView:document.getElementById('resultsView'),
    homeBtn:document.getElementById('homeBtn'),
    startBtn:document.getElementById('startBtn'),
    stepPill:document.getElementById('stepPill'),
    stepText:document.getElementById('stepText'),
    questionTotalText:document.getElementById('questionTotalText'),
    progressBar:document.getElementById('progressBar'),
    eyebrow:document.getElementById('eyebrow'),
    questionTitle:document.getElementById('questionTitle'),
    questionHelp:document.getElementById('questionHelp'),
    choices:document.getElementById('choices'),
    prevBtn:document.getElementById('prevBtn'),
    books:document.getElementById('books'),
    aladinBestSellers:document.getElementById('aladinBestSellers'),
    popularBooks:document.getElementById('popularBooks'),
    libraryNews:document.getElementById('libraryNews'),
    instagramFeed:document.getElementById('instagramFeed'),
    instagramProfileName:document.getElementById('instagramProfileName'),
    instagramProfilePhoto:document.getElementById('instagramProfilePhoto'),
    instagramPostCount:document.getElementById('instagramPostCount'),
    instagramFollowerCount:document.getElementById('instagramFollowerCount'),
    instagramFollowingCount:document.getElementById('instagramFollowingCount'),
    resultTitle:document.getElementById('resultTitle'),
    resultSummary:document.getElementById('resultSummary'),
    restartBtn:document.getElementById('restartBtn'),
    printResultBtn:document.getElementById('printResultBtn'),
    emailResultBtn:document.getElementById('emailResultBtn'),
    emailResultModal:document.getElementById('emailResultModal'),
    emailResultForm:document.getElementById('emailResultForm'),
    resultEmailLocal:document.getElementById('resultEmailLocal'),
    resultEmailDomain:document.getElementById('resultEmailDomain'),
    sendEmailBtn:document.getElementById('sendEmailBtn'),
    emailStatus:document.getElementById('emailStatus'),
    errorBox:document.getElementById('errorBox'),
    resultError:document.getElementById('resultError'),
    stage:document.querySelector('.stage'),
    resultHero:document.querySelector('.result-hero')
  };

  function validQuestion(question){
    return question
      && typeof question.id === 'string'
      && typeof question.title === 'string'
      && Array.isArray(question.choices)
      && question.choices.length > 1;
  }

  function cloneQuestion(question){
    return JSON.parse(JSON.stringify(question));
  }

  function withFixedCategoryQuestion(questions){
    const baseQuestions = questions.filter(question=>question.id !== CATEGORY_QUESTION_ID).slice(0, 5);
    if(!ENABLE_CATEGORY_QUESTION) return baseQuestions;
    return [
      ...baseQuestions,
      cloneQuestion(FIXED_CATEGORY_QUESTION)
    ];
  }

  function trackAiRecommendationStart(){
    if(typeof window.gtag !== 'function') return;
    window.gtag('event', 'ai_recommendation_start', {
      event_category:'engagement',
      event_label:document.body.classList.contains('kiosk-page') ? 'kiosk' : 'main'
    });
  }

  function trackAiRecommendationPrint(count){
    if(typeof window.gtag !== 'function') return;
    window.gtag('event', 'ai_recommendation_print', {
      event_category:'engagement',
      event_label:document.body.classList.contains('kiosk-page') ? 'kiosk' : 'main',
      value:count,
      item_count:count
    });
  }

  async function fetchQuestionSet(){
    const res = await fetch('/.netlify/functions/questions?limit=5', {
      headers:{ accept:'application/json' }
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || `질문 API 오류: ${res.status}`);
    const questions = Array.isArray(data.questions) ? data.questions.filter(validQuestion) : [];
    if(!questions.length) throw new Error('사용할 수 있는 질문이 없습니다.');
    return {
      questions:withFixedCategoryQuestion(questions),
      seed:data.seed || newSeed()
    };
  }

  async function loadQuestionSet(){
    if(questionLoadPromise) return questionLoadPromise;
    questionLoadPromise = fetchQuestionSet()
      .then(({ questions, seed })=>{
        QUESTIONS = questions;
        sessionSeed = seed;
        state.index = 0;
        state.answers = {};
        return QUESTIONS;
      })
      .finally(()=>{ questionLoadPromise = null; });
    return questionLoadPromise;
  }
  async function refreshQuestionSet(){
    QUESTIONS = [];
    state.index = 0;
    state.answers = {};
    return loadQuestionSet();
  }

  function cancelRecommendationRequest(){
    activeRecommendationRequestId += 1;
    if(recommendationAbortController){
      recommendationAbortController.abort();
      recommendationAbortController = null;
    }
  }

  function beginRecommendationRequest(){
    cancelRecommendationRequest();
    recommendationAbortController = new AbortController();
    return {
      id:activeRecommendationRequestId,
      signal:recommendationAbortController.signal
    };
  }

  function isCurrentRecommendationRequest(requestId){
    return requestId === activeRecommendationRequestId;
  }

  function currentQuestion(){ return QUESTIONS[state.index]; }
  function selectedChoice(){ return state.answers[currentQuestion().id]; }
  function setError(target, message){
    target.textContent = message || '';
    target.setAttribute('aria-hidden', message ? 'false' : 'true');
  }
  function renderAccentText(target, value, preferredPhrases = []){
    if(!target) return;
    const text = String(value || '');
    const phrases = [...preferredPhrases, ...TITLE_ACCENT_PHRASES]
      .filter(Boolean)
      .map(String);
    const phrase = phrases
      .filter(item => text.includes(item))
      .sort((a, b) => b.length - a.length)[0];
    if(!phrase){
      target.textContent = text;
      return;
    }
    const index = text.indexOf(phrase);
    const accent = document.createElement('span');
    accent.className = 'title-gradient';
    accent.textContent = phrase;
    target.replaceChildren(
      document.createTextNode(text.slice(0, index)),
      accent,
      document.createTextNode(text.slice(index + phrase.length))
    );
  }
  function renderResultTitle(value){
    const text = String(value || 'AI가 건네는 책');
    const phrase = RESULT_TITLE_ACCENT_PHRASES.find(item => text.includes(item));
    if(phrase){
      renderAccentText(els.resultTitle, text, [phrase]);
      return;
    }
    const structuralMatch = text.match(/^(.+?)(?:을|를|이|가|와|과)\s+[^\s]+(?:\s+책)?$/);
    const structuralPhrase = structuralMatch && structuralMatch[1] && structuralMatch[1].length >= 2
      ? structuralMatch[1].trim()
      : '';
    renderAccentText(els.resultTitle, text, structuralPhrase ? [structuralPhrase] : []);
  }
  function renderQuestion(){
    const q = currentQuestion();
    const selected = selectedChoice();
    const step = state.index + 1;
    setAuraClass(els.stage, 'aura-balanced');
    els.stage.classList.toggle('is-category-question', q.layout === 'category-grid');
    els.stepPill.textContent = `${step} / ${QUESTIONS.length}`;
    els.stepText.textContent = `${step}번째 질문`;
    if(els.questionTotalText) els.questionTotalText.textContent = `${QUESTIONS.length}문항`;
    els.progressBar.style.width = `${(step / QUESTIONS.length) * 100}%`;
    els.eyebrow.textContent = q.eyebrow;
    renderAccentText(els.questionTitle, q.title);
    els.questionHelp.textContent = q.help || '';
    els.questionHelp.hidden = !q.help;
    els.prevBtn.disabled = state.index === 0;
    setError(els.errorBox, '');
    els.choices.innerHTML = '';
    els.choices.classList.toggle('is-category-grid', q.layout === 'category-grid');

    q.choices.forEach(choice=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `choice aura-balanced${q.layout === 'category-grid' ? ' category-choice' : ''}${selected && selected.id === choice.id ? ' is-selected' : ''}`;
      btn.innerHTML = '<span class="emoji"></span><span class="choice-copy"><b></b><small></small></span>';
      btn.querySelector('.emoji').textContent = choice.emoji;
      btn.querySelector('b').textContent = choice.label;
      btn.querySelector('small').textContent = choice.desc;
      btn.addEventListener('click', ()=>{
        state.answers[q.id] = choice;
        if(state.index < QUESTIONS.length - 1){
          state.index += 1;
          renderQuestion();
        }else{
          submit();
        }
      });
      els.choices.appendChild(btn);
    });
  }
  function answerPayload(){
    return QUESTIONS.map(q=>({ questionId:q.id, question:q.title, choice:state.answers[q.id] }));
  }
  function selectedCategoryFilter(){
    const choice = state.answers[CATEGORY_QUESTION_ID];
    return choice && choice.categoryFilter ? choice.categoryFilter : { id:'any', label:'아무거나(AI추천)' };
  }
  function normalizeIsbn(value){
    const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    return isbn.length === 10 || isbn.length === 13 ? isbn : '';
  }
  function isbn10To13(value){
    const isbn = normalizeIsbn(value);
    if(isbn.length === 13) return isbn;
    if(isbn.length !== 10 || !/^\d{9}[\dX]$/.test(isbn)) return '';
    const body = `978${isbn.slice(0, 9)}`;
    let sum = 0;
    for(let i = 0; i < body.length; i += 1){
      sum += Number.parseInt(body[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    return `${body}${(10 - (sum % 10)) % 10}`;
  }
  function isbn13To10(value){
    const isbn = normalizeIsbn(value);
    if(isbn.length === 10) return isbn;
    if(isbn.length !== 13 || !isbn.startsWith('978') || !/^\d{13}$/.test(isbn)) return '';
    const body = isbn.slice(3, 12);
    let sum = 0;
    for(let i = 0; i < body.length; i += 1){
      sum += Number.parseInt(body[i], 10) * (10 - i);
    }
    const checkValue = (11 - (sum % 11)) % 11;
    return `${body}${checkValue === 10 ? 'X' : checkValue}`;
  }
  function isbnVariants(...values){
    const variants = new Set();
    values.forEach(value=>{
      const isbn = normalizeIsbn(value);
      if(!isbn) return;
      variants.add(isbn);
      const converted = isbn.length === 10 ? isbn10To13(isbn) : isbn13To10(isbn);
      if(converted) variants.add(converted);
    });
    return [...variants];
  }
  function addCatalogSearchParams(url, value, field = 'I'){
    url.searchParams.set('app', 'mirtech');
    url.searchParams.set('mod', 'list');
    url.searchParams.set('st', '0');
    url.searchParams.append('field[]', field);
    url.searchParams.append('query[]', value);
    url.searchParams.append('material[]', 'DA');
    url.searchParams.append('collect[]', 'ALL');
    url.searchParams.append('ddc[]', 'ALL');
    url.searchParams.set('lang', 'ALL');
    url.searchParams.set('publish_s_year', '');
    url.searchParams.set('publish_e_year', '');
    url.searchParams.set('record_per_page', '10');
    url.searchParams.set('orderby', 'T');
    url.searchParams.set('order', 'asc');
  }
  function libraryCatalogSearchUrl(value, field = 'I'){
    const url = new URL(LIBRARY_CATALOG_URL);
    addCatalogSearchParams(url, value, field);
    return url.toString();
  }
  function libraryCatalogRestUrl(value, field = 'I'){
    const url = new URL(LIBRARY_CATALOG_REST_URL);
    addCatalogSearchParams(url, value, field);
    return url.toString();
  }
  function normalizeCatalogDetailUrl(value, baseUrl = LIBRARY_CATALOG_URL){
    const url = new URL(String(value || '').replace(/&amp;/g, '&'), baseUrl);
    const recordId = url.searchParams.get('record_id') || (url.toString().match(/record_id=(\d+)/i) || [])[1];
    if(!recordId) return url.toString();
    const detail = new URL(LIBRARY_CATALOG_URL);
    detail.searchParams.set('app', 'mirtech');
    detail.searchParams.set('mod', 'detail');
    detail.searchParams.set('record_id', recordId);
    return detail.toString();
  }
  function cleanHtmlText(value){
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    return (template.content.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function comparableTitle(value){
    return cleanHtmlText(value)
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function titleBases(value){
    const raw = cleanHtmlText(value);
    const withoutBracketed = raw
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const firstRaw = raw.split(/\s+(?:-|–|—|―)\s+|[:：|]/)[0];
    const firstWithoutBracketed = withoutBracketed.split(/\s+(?:-|–|—|―)\s+|[:：|]/)[0];
    return [...new Set([raw, withoutBracketed, firstRaw, firstWithoutBracketed]
      .map(comparableTitle)
      .filter(part=>part && part.length >= 2))];
  }
  function titlesMatch(left, right){
    if(!left || !right) return false;
    if(left === right) return true;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length > right.length ? left : right;
    return shorter.length >= 4 && longer.includes(shorter);
  }
  function extractCatalogEntries(baseUrl, html){
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const entries = [];
    const seen = new Set();
    doc.querySelectorAll('a[href*="record_id="]').forEach(anchor=>{
      const href = anchor.getAttribute('href') || '';
      const catalogUrl = normalizeCatalogDetailUrl(href, baseUrl);
      const recordId = (catalogUrl.match(/record_id=(\d+)/i) || [])[1] || catalogUrl;
      const item = anchor.closest('.book-horizontal-item, .book-item, li') || anchor.parentElement?.parentElement?.parentElement || anchor.parentElement || doc.body;
      const nearbyHtml = item.innerHTML || '';
      const isbn = normalizeIsbn(
        anchor.getAttribute('isbn')
        || item.querySelector('[isbn]')?.getAttribute('isbn')
        || (nearbyHtml.match(/\bisbn=["']([^"']+)["']/i) || [])[1]
      );
      const seenKey = isbn || recordId;
      if(seen.has(seenKey)) return;
      const title = cleanHtmlText(item.querySelector('.item-subject')?.textContent || anchor.textContent);
      if(!title) return;
      seen.add(seenKey);
      entries.push({ isbn, title, catalogUrl });
    });
    return entries;
  }
  function selectHolding(book, entries){
    const bookIsbns = isbnVariants(book && book.isbn);
    const exact = entries.find(entry=>isbnVariants(entry && entry.isbn).some(isbn=>bookIsbns.includes(isbn)));
    if(exact) return exact;
    const bookTitles = titleBases(book && book.title);
    return entries.find(entry=>{
      const entryTitles = titleBases(entry && entry.title);
      return bookTitles.some(title=>entryTitles.some(entryTitle=>titlesMatch(title, entryTitle)));
    }) || null;
  }
  async function checkLiveHolding(book){
    const isbn = normalizeIsbn(book && book.isbn);
    const searchValue = isbn || cleanHtmlText(book && book.title);
    const searchField = isbn ? 'I' : 'T';
    const catalogSearchUrl = libraryCatalogSearchUrl(searchValue, searchField);
    if(!searchValue){
      return { ...book, isOwned:false, holdingChecked:false, actionLabel:'도서관에서 직접 확인', actionUrl:LIBRARY_CATALOG_URL };
    }

    try{
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), 9000);
      let res;
      try{
        res = await fetch(libraryCatalogRestUrl(searchValue, searchField), {
          headers:{ accept:'application/json' },
          signal:controller.signal
        });
      }finally{
        clearTimeout(timer);
      }
      const payload = await res.json();
      if(!res.ok) throw new Error(`도서관 API 오류: ${res.status}`);
      const html = payload && payload.content && payload.content.rendered ? payload.content.rendered : '';
      const entries = extractCatalogEntries(catalogSearchUrl, html);
      const holding = selectHolding({ title:book.title, isbn }, entries) || (isbn ? entries[0] : null);
      const isOwned = Boolean(holding);
      return {
        ...book,
        isOwned,
        holdingChecked:true,
        libraryCatalogUrl:isOwned ? holding.catalogUrl : '',
        actionLabel:isOwned ? '소장위치 확인' : '희망도서 신청하기',
        actionUrl:isOwned ? holding.catalogUrl : PURCHASE_REQUEST_URL,
        catalogSearchUrl
      };
    }catch(error){
      console.warn('Library catalog lookup failed', error);
      return {
        ...book,
        isOwned:false,
        holdingChecked:false,
        libraryCatalogUrl:'',
        actionLabel:'도서관에서 직접 확인',
        actionUrl:catalogSearchUrl,
        catalogSearchUrl
      };
    }
  }
  async function resolveCatalogDetailLink(book){
    const current = String(book && book.libraryCatalogUrl || '');
    if(/record_id=\d+/i.test(current)) return book;

    const isbn = normalizeIsbn(book && book.isbn);
    const searchValue = isbn || cleanHtmlText(book && book.title);
    const searchField = isbn ? 'I' : 'T';
    if(!searchValue) return book;

    const catalogSearchUrl = current || libraryCatalogSearchUrl(searchValue, searchField);
    try{
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), 9000);
      let res;
      try{
        res = await fetch(libraryCatalogRestUrl(searchValue, searchField), {
          headers:{ accept:'application/json' },
          signal:controller.signal
        });
      }finally{
        clearTimeout(timer);
      }
      const payload = await res.json();
      if(!res.ok) throw new Error(`Library catalog API error: ${res.status}`);
      const html = payload && payload.content && payload.content.rendered ? payload.content.rendered : '';
      const entries = extractCatalogEntries(catalogSearchUrl, html);
      const holding = selectHolding({ title:book.title, isbn }, entries) || (isbn ? entries[0] : null);
      return holding && holding.catalogUrl
        ? { ...book, libraryCatalogUrl:holding.catalogUrl }
        : { ...book, libraryCatalogUrl:catalogSearchUrl };
    }catch(error){
      console.warn('Library detail link lookup failed', error);
      return { ...book, libraryCatalogUrl:catalogSearchUrl };
    }
  }
  async function enrichAladinHoldings(data){
    const books = Array.isArray(data && data.aladinBestSellers) ? data.aladinBestSellers : [];
    if(!books.length) return data;

    try {
      return {
        ...data,
        aladinBestSellers:await Promise.all(books.map(checkLiveHolding))
      };
    }catch(error){
      console.warn('Library holding status failed', error);
      return data;
    }
  }
  async function enrichClientCatalogData(data){
    const items = Array.isArray(data && data.items) ? data.items : [];
    const [itemsWithLinks, dataWithAladin] = await Promise.all([
      items.length ? Promise.all(items.map(resolveCatalogDetailLink)) : Promise.resolve(items),
      enrichAladinHoldings(data)
    ]);
    return {
      ...dataWithAladin,
      items:itemsWithLinks
    };
  }
  async function submit(){
    const missing = QUESTIONS.find(q=>!state.answers[q.id]);
    if(missing){
      setError(els.errorBox, '아직 선택하지 않은 질문이 있습니다.');
      return;
    }
    els.quizView.hidden = true;
    els.resultsView.setAttribute('aria-hidden','true');
    els.loadingView.setAttribute('aria-hidden','false');
    currentRecommendation = null;
    setError(els.resultError, '');
    const request = beginRecommendationRequest();

    try{
      const res = await fetch(`/.netlify/functions/recommend-books?_=${Date.now()}`, {
        method:'POST',
        cache:'no-store',
        signal:request.signal,
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          answers:answerPayload(),
          categoryFilter:selectedCategoryFilter(),
          limit:6,
          popularLimit:5,
          seed:sessionSeed,
          excludeIsbns:recentRecommendationIsbns()
        })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.message || data.error || `추천 API 오류: ${res.status}`);
      if(!isCurrentRecommendationRequest(request.id)) return;
      const enrichedData = await enrichClientCatalogData(data);
      if(!isCurrentRecommendationRequest(request.id)) return;
      recommendationAbortController = null;
      renderResults(enrichedData);
    }catch(error){
      if(!isCurrentRecommendationRequest(request.id) || error.name === 'AbortError') return;
      recommendationAbortController = null;
      els.loadingView.setAttribute('aria-hidden','true');
      els.resultsView.setAttribute('aria-hidden','false');
      setError(els.resultError, error.message || '책 추천을 불러오지 못했습니다.');
    }
  }
  function escapeSvgText(value){
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  function externalCoverUrl(book){
    const isbn = String(book && book.isbn || '').replace(/[^0-9Xx]/g, '');
    if(isbn){
      return `https://books.google.com/books/content?vid=ISBN${encodeURIComponent(isbn)}&printsec=frontcover&img=1&zoom=1&source=gbs_api`;
    }
    return '';
  }
  function externalCoverUrls(book){
    return isbnVariants(book && book.isbn).flatMap(isbn=>[
      `https://books.google.com/books/content?vid=ISBN${encodeURIComponent(isbn)}&printsec=frontcover&img=1&zoom=1&source=gbs_api`,
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`
    ]);
  }
  function fallbackCover(title = ''){
    const shortTitle = escapeSvgText(String(title || '책 표지').replace(/\s+/g, ' ').trim().slice(0, 24));
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 340">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#dff2ff"/>
            <stop offset=".58" stop-color="#f8fcff"/>
            <stop offset="1" stop-color="#b9ddf7"/>
          </linearGradient>
          <radialGradient id="cloud" cx=".3" cy=".2" r=".8">
            <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/>
            <stop offset="1" stop-color="#6baee4" stop-opacity=".15"/>
          </radialGradient>
        </defs>
        <rect width="240" height="340" rx="10" fill="url(#bg)"/>
        <circle cx="54" cy="70" r="76" fill="url(#cloud)"/>
        <circle cx="190" cy="264" r="92" fill="#7ab8e8" opacity=".18"/>
        <path d="M54 246c38-34 83-34 132 0" fill="none" stroke="#2875b5" stroke-width="2" opacity=".28"/>
        <text x="120" y="138" text-anchor="middle" font-family="serif" font-size="25" font-weight="700" fill="#175184">AI Book Finder</text>
        <text x="120" y="182" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#38546d">${shortTitle}</text>
        <text x="120" y="214" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="#6d8499">AI 추천도서</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  function coverForBook(book, options = {}){
    const covers = coverCandidatesForBook(book);
    if(covers.length) return covers[0];
    if(options.preferDesignedFallback) return fallbackCover(book.title);
    return fallbackCover(book.title);
  }
  function coverCandidatesForBook(book){
    const seen = new Set();
    const sources = [
      book && book.cover,
      ...((book && Array.isArray(book.coverFallbacks)) ? book.coverFallbacks : []),
      ...externalCoverUrls(book)
    ];
    return sources
      .map(src=>String(src || '').trim())
      .filter(src=>{
        if(!src || seen.has(src)) return false;
        if(/thumb_book_175x246_none|book-default|no[_-]?image|placeholder/i.test(src)) return false;
        seen.add(src);
        return true;
      });
  }
  function installCoverFallback(img, book){
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    const fallbacks = coverCandidatesForBook(book).filter(src=>src !== img.getAttribute('src'));
    let fallbackIndex = 0;
    img.addEventListener('error', ()=>{
      while(fallbackIndex < fallbacks.length){
        const next = fallbacks[fallbackIndex];
        fallbackIndex += 1;
        if(next && next !== img.getAttribute('src')){
          img.src = next;
          return;
        }
      }
      if(img.dataset.fallbackApplied === '1') return;
      img.dataset.fallbackApplied = '1';
      img.src = fallbackCover(book.title);
    });
  }
  function descriptionText(book){
    const text = String(book.description || '').trim();
    if(text) return text;
    return '알라딘 API에서 상세 책 소개가 제공되지 않은 도서입니다. 도서관 서지 정보와 소장 위치를 확인해 보세요.';
  }
  function cleanDisplayName(value){
    return String(value || '').replace(/\s*[,，、;；]+\s*$/g, '').trim();
  }
  function bookMetaItems(book, options = {}){
    const items = [
      { label:'저자', value:cleanDisplayName(book && book.author) },
      { label:'출판사', value:book && book.publisher },
    ];
    if(options.includeCollection !== false){
      items.push({ label:'분류', value:book && book.collection });
    }
    return items
      .map(item=>({ ...item, value:String(item.value || '').trim() }))
      .filter(item=>item.value);
  }
  function renderBookMeta(target, book, options = {}){
    if(!target) return;
    target.innerHTML = '';
    const metaItems = bookMetaItems(book, options);
    if(!metaItems.length){
      const empty = document.createElement('span');
      empty.className = 'book-meta-empty';
      empty.textContent = '서지 정보 확인 중';
      target.appendChild(empty);
      return;
    }
    metaItems.forEach(item=>{
      const chip = document.createElement('span');
      chip.className = 'book-meta-chip';
      const label = document.createElement('b');
      label.textContent = item.label;
      const value = document.createElement('span');
      value.textContent = item.value;
      chip.append(label, value);
      target.appendChild(chip);
    });
  }
  function bookMetaText(book){
    return bookMetaItems(book).map(item=>item.value).join(' · ');
  }
  function firstDisplayText(...values){
    return values
      .map(value=>String(value || '').trim())
      .find(Boolean) || '';
  }
  function escapeHtml(value){
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function printBookInfoItems(book){
    const keywords = Array.isArray(book && book.matchedTags)
      ? book.matchedTags.slice(0,4).map(tag=>String(tag || '').trim()).filter(Boolean).join(', ')
      : '';
    return [
      { label:'저자', value:cleanDisplayName(book && book.author) },
      { label:'출판사', value:firstDisplayText(book && book.publisher) },
      { label:'키워드', value:keywords },
    ].filter(item=>item.value);
  }
  function printCoverSources(book){
    const sources = coverCandidatesForBook(book);
    const fallback = fallbackCover(book && book.title);
    return sources.includes(fallback) ? sources : [...sources, fallback];
  }
  function printStyles(){
    return `
      @page{margin:0}
      *{box-sizing:border-box}
      html,body{margin:0; padding:0; width:80mm; min-width:80mm; background:#fff; color:#000}
      body{
        font-family:Arial,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;
        font-synthesis:weight;
        text-rendering:geometricPrecision;
      }
      .receipt{width:80mm; min-height:100vh; padding:4mm 3mm 5mm; background:#fff; color:#000}
      .receipt-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:4mm;
        padding:0 0 3mm;
        border-bottom:.45mm solid #000;
        color:#000;
      }
      .receipt-head h1{
        flex:0 0 auto;
        margin:0;
        color:#000;
        font-size:18pt;
        line-height:1.08;
        font-weight:900;
        letter-spacing:0;
      }
      .receipt-head p{
        flex:1 1 auto;
        margin:1.8mm 0 0;
        color:#000;
        font-size:8.6pt;
        line-height:1.25;
        font-weight:900;
        text-align:left;
        word-break:keep-all;
        overflow-wrap:anywhere;
      }
      .book{
        display:grid;
        grid-template-columns:27mm minmax(0,1fr);
        gap:3.4mm;
        align-items:start;
        padding:3.8mm 0;
        border-top:.25mm solid #000;
        break-inside:avoid;
        page-break-inside:avoid;
        color:#000;
      }
      .receipt-head + .book{border-top:0}
      .cover-wrap{width:27mm; min-height:39mm; display:grid; place-items:center}
      .cover{
        display:block;
        width:27mm;
        max-height:40mm;
        object-fit:contain;
        border:.2mm solid #000;
        background:#fff;
      }
      .book-body{min-width:0; color:#000}
      .rank{
        margin:0 0 1.4mm;
        color:#000;
        font-size:8.5pt;
        line-height:1;
        font-weight:900;
      }
      .title{
        margin:0;
        color:#000;
        font-size:12.6pt;
        line-height:1.26;
        font-weight:900;
        letter-spacing:0;
        word-break:keep-all;
        overflow-wrap:anywhere;
      }
      .meta{display:grid; gap:.8mm; margin:2mm 0 0}
      .meta-row{
        display:grid;
        grid-template-columns:10mm minmax(0,1fr);
        gap:1.4mm;
        margin:0;
        color:#000;
        font-size:8.8pt;
        line-height:1.35;
        font-weight:800;
        word-break:keep-all;
        overflow-wrap:anywhere;
      }
      .meta-row b{
        color:#000;
        font-size:7.6pt;
        line-height:1.35;
        font-weight:900;
      }
      .meta-row span{color:#000; font-weight:900}
      .receipt-foot{
        padding:2.6mm 0 0;
        border-top:.25mm solid #000;
        text-align:center;
        color:#000;
        font-size:7.6pt;
        line-height:1.2;
        font-weight:700;
      }
      @media screen{
        body{background:#f4f4f4}
        .receipt{min-height:100vh}
      }
    `;
  }
  function printBookHtml(book, index){
    const covers = printCoverSources(book);
    const src = covers[0] || fallbackCover(book && book.title);
    const fallbacks = covers.slice(1);
    const infoItems = printBookInfoItems(book);
    if(!infoItems.length){
      infoItems.push({ label:'도서정보', value:'서지 정보 확인 중' });
    }
    const meta = infoItems.map(item=>`
      <p class="meta-row"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.value)}</span></p>
    `).join('');
    return `
      <article class="book">
        <div class="cover-wrap">
          <img class="cover" alt="" src="${escapeHtml(src)}" data-fallbacks="${escapeHtml(JSON.stringify(fallbacks))}" referrerpolicy="no-referrer">
        </div>
        <div class="book-body">
          <p class="rank">${String(index + 1).padStart(2, '0')}</p>
          <h2 class="title">${escapeHtml(book && book.title || '제목 정보 없음')}</h2>
          <div class="meta">${meta}</div>
        </div>
      </article>
    `;
  }
  function printDocumentHtml(items){
    const shelfTitle = firstDisplayText(currentRecommendation && currentRecommendation.shelfTitle, '동아대학교 도서관');
    const printedAt = new Intl.DateTimeFormat('ko-KR', {
      timeZone:'Asia/Seoul',
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit'
    }).format(new Date());
    return `<!doctype html>
      <html lang="ko">
      <head>
        <meta charset="utf-8">
        <title>AI 추천도서 출력</title>
        <style>${printStyles()}</style>
      </head>
      <body>
        <main class="receipt">
          <div class="receipt-head">
            <h1>AI 추천도서</h1>
            <p>${escapeHtml(shelfTitle)}</p>
          </div>
          ${items.map(printBookHtml).join('')}
          <div class="receipt-foot">${escapeHtml(printedAt)}</div>
        </main>
        <script>
          document.querySelectorAll('img[data-fallbacks]').forEach(function(img){
            var fallbacks = [];
            try{ fallbacks = JSON.parse(img.getAttribute('data-fallbacks') || '[]'); }catch(_){}
            var index = 0;
            img.addEventListener('error', function(){
              if(index >= fallbacks.length) return;
              img.src = fallbacks[index++];
            });
          });
        <\/script>
      </body>
      </html>`;
  }
  function waitForPrintImages(doc){
    const images = [...doc.querySelectorAll('img')].filter(img=>img.src);
    if(!images.length) return Promise.resolve();
    const waits = images.map(img=>new Promise(resolve=>{
      const finish = ()=>{
        window.clearTimeout(timer);
        resolve();
      };
      const check = ()=>{
        img.removeEventListener('load', check);
        img.removeEventListener('error', check);
        if(img.complete || !img.src){
          finish();
          return;
        }
        img.addEventListener('load', check, { once:true });
        img.addEventListener('error', check, { once:true });
      };
      const timer = window.setTimeout(finish, 2200);
      check();
    }));
    return Promise.all(waits);
  }
  async function printHtmlDocument(html){
    document.querySelectorAll('iframe[data-print-frame="recommendations"]').forEach(frame=>frame.remove());
    const frame = document.createElement('iframe');
    frame.dataset.printFrame = 'recommendations';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.left = '-10000px';
    frame.style.top = '0';
    frame.style.width = '80mm';
    frame.style.height = '1px';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    document.body.appendChild(frame);

    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    const frameWindow = frame.contentWindow;
    await new Promise(resolve=>setTimeout(resolve, 80));
    await Promise.all([
      waitForPrintImages(doc),
      doc.fonts && doc.fonts.ready ? doc.fonts.ready.catch(()=>{}) : Promise.resolve()
    ]);
    await new Promise(resolve=>frameWindow.requestAnimationFrame(()=>resolve()));

    let cleaned = false;
    const cleanup = ()=>{
      if(cleaned) return;
      cleaned = true;
      frame.remove();
    };
    frameWindow.addEventListener('afterprint', cleanup, { once:true });
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(cleanup, 30000);
  }
  async function printRecommendationList(){
    const items = currentRecommendation && Array.isArray(currentRecommendation.items)
      ? currentRecommendation.items
      : [];
    if(!items.length){
      setError(els.resultError, '프린트할 추천도서가 없습니다. 다시 추천을 진행해 주세요.');
      return;
    }
    setError(els.resultError, '');
    if(els.printResultBtn) els.printResultBtn.disabled = true;
    try{
      trackAiRecommendationPrint(items.length);
      await printHtmlDocument(printDocumentHtml(items));
    }finally{
      if(els.printResultBtn) els.printResultBtn.disabled = false;
    }
  }
  function renderMainBooks(items){
    els.books.innerHTML = '';
    (items || []).forEach((book, index)=>{
      const card = document.createElement('article');
      card.className = `book ${bookAuraClass(book, index)}`;
      const cover = coverForBook(book);
      const tags = (book.matchedTags || []).slice(0,4).map(tag=>`<span class="tag">${tag}</span>`).join('');
      card.innerHTML = `
        <img class="cover" alt="" src="${cover}">
        <div class="book-body">
          <div class="book-number"></div>
          <h3 class="book-title"></h3>
          <div class="book-meta"></div>
          <p class="reason"></p>
          <div class="tag-row">${tags}</div>
          <div class="book-actions">
            <a class="catalog-link" target="_blank" rel="noopener noreferrer">소장위치 확인</a>
            <a class="aladin-book-link" target="_blank" rel="noopener noreferrer" aria-label="알라딘에서 보기"><img src="img/aladin.png" alt="알라딘"><span>⌕</span></a>
          </div>
        </div>
      `;
      card.querySelector('.book-number').textContent = String(index + 1).padStart(2, '0');
      card.querySelector('.book-title').textContent = book.title || '제목 정보 없음';
      renderBookMeta(card.querySelector('.book-meta'), book, { includeCollection:false });
      card.querySelector('.reason').textContent = descriptionText(book);
      card.querySelector('.catalog-link').href = book.libraryCatalogUrl || book.link || '#';
      const aladinLink = card.querySelector('.aladin-book-link');
      if(book.link){
        aladinLink.href = book.link;
      }else{
        aladinLink.hidden = true;
      }
      installCoverFallback(card.querySelector('img'), book);
      els.books.appendChild(card);
    });
  }
  function renderPopularBooks(items){
    els.popularBooks.innerHTML = '';
    const books = items || [];
    if(!books.length){
      const empty = document.createElement('div');
      empty.className = 'popular-empty';
      empty.textContent = '도서관 인기도서 목록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.';
      els.popularBooks.appendChild(empty);
      return;
    }
    books.forEach((book, index)=>{
      const link = document.createElement('a');
      link.className = `popular-card ${bookAuraClass(book, index + 2)}`;
      link.href = book.libraryCatalogUrl || book.link || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.innerHTML = `
        <img class="popular-cover" alt="" src="${coverForBook(book, { preferDesignedFallback:true })}">
        <div class="popular-title"></div>
        <div class="popular-meta"></div>
      `;
      link.querySelector('.popular-title').textContent = book.title || '제목 정보 없음';
      link.querySelector('.popular-meta').textContent = bookMetaText(book) || '인기도서';
      installCoverFallback(link.querySelector('img'), book);
      els.popularBooks.appendChild(link);
    });
  }
  function renderAladinBestSellers(items){
    if(!els.aladinBestSellers) return;
    els.aladinBestSellers.innerHTML = '';
    const books = items || [];
    if(!books.length){
      const empty = document.createElement('div');
      empty.className = 'popular-empty';
      empty.textContent = '알라딘 베스트셀러 정보를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.';
      els.aladinBestSellers.appendChild(empty);
      return;
    }
    books.slice(0, 6).forEach((book, index)=>{
      const isOwned = Boolean(book.isOwned || book.libraryCatalogUrl);
      const isUnknown = !isOwned && book.holdingChecked === false;
      const card = document.createElement('article');
      card.className = `aladin-card ${isOwned ? 'is-owned' : (isUnknown ? 'is-unknown' : 'is-request')}`;
      card.innerHTML = `
        <img class="aladin-cover" alt="" src="${coverForBook(book, { preferDesignedFallback:true })}">
        <div class="aladin-body">
          <div class="aladin-rank"></div>
          <h4></h4>
          <p class="aladin-meta"></p>
          <span class="aladin-state"></span>
          <div class="aladin-actions">
            <a class="library-action" target="_blank" rel="noopener noreferrer"></a>
            <a class="aladin-link" target="_blank" rel="noopener noreferrer" aria-label="알라딘에서 보기"><img class="aladin-logo" src="img/aladin.png" alt="알라딘"><span>⌕</span></a>
          </div>
        </div>
      `;
      card.querySelector('.aladin-rank').textContent = `BEST ${String(book.rank || index + 1).padStart(2, '0')}`;
      card.querySelector('h4').textContent = book.title || '제목 정보 없음';
      card.querySelector('.aladin-meta').textContent = [cleanDisplayName(book.author), book.publisher].filter(Boolean).join(' · ') || '알라딘 베스트셀러';
      card.querySelector('.aladin-state').textContent = isOwned
        ? '도서관 소장중'
        : (isUnknown ? '도서관 확인 중' : '도서관 미소장');
      const action = card.querySelector('.library-action');
      action.href = isOwned
        ? (book.libraryCatalogUrl || book.actionUrl || book.link || '#')
        : (book.actionUrl || book.requestUrl || book.link || '#');
      action.textContent = isOwned
        ? '소장위치 확인'
        : (book.actionLabel || (isUnknown ? '도서관에서 직접 확인' : '희망도서 신청하기'));
      const aladinLink = card.querySelector('.aladin-link');
      if(book.link){
        aladinLink.href = book.link;
      }else{
        aladinLink.hidden = true;
      }
      installCoverFallback(card.querySelector('img'), book);
      els.aladinBestSellers.appendChild(card);
    });
  }
  function renderLibraryNews(items, options = {}){
    if(!els.libraryNews) return;
    els.libraryNews.innerHTML = '';
    const notices = items || [];
    if(!notices.length){
      const empty = document.createElement('div');
      empty.className = 'news-empty';
      empty.textContent = options.message || '도서관 최신 공지를 불러오지 못했습니다. 전체보기에서 커뮤니티 페이지를 확인해 주세요.';
      els.libraryNews.appendChild(empty);
      return;
    }
    notices.slice(0, 5).forEach((notice, index)=>{
      const link = document.createElement('a');
      link.className = 'news-card';
      link.href = notice.url || 'https://library.donga.ac.kr/community/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const thumbnail = String(notice.thumbnail || notice.image || notice.imageUrl || '').trim();
      link.innerHTML = `
        <span class="news-media">
          <img alt="" loading="lazy">
          <span class="news-index"></span>
        </span>
        <span class="news-copy">
          <strong></strong>
          <small></small>
        </span>
        <span class="news-date"></span>
      `;
      const image = link.querySelector('img');
      if(thumbnail){
        image.src = thumbnail;
        image.addEventListener('error', ()=>{
          link.classList.add('no-thumb');
          image.removeAttribute('src');
        }, { once:true });
      }else{
        link.classList.add('no-thumb');
      }
      link.querySelector('.news-index').textContent = String(index + 1).padStart(2, '0');
      link.querySelector('strong').textContent = notice.title || '도서관 공지';
      link.querySelector('small').textContent = [notice.author, notice.views].filter(Boolean).join(' · ') || '동아대학교 도서관';
      link.querySelector('.news-date').textContent = notice.date || '';
      els.libraryNews.appendChild(link);
    });
  }
  async function refreshLibraryNews(currentItems = []){
    if(!currentItems.length){
      renderLibraryNews([], { message:'도서관 최신 공지를 확인하는 중입니다.' });
    }
    try{
      const res = await fetch(`/.netlify/functions/library-news?limit=5&_=${Date.now()}`, {
        cache:'no-store',
        headers:{ accept:'application/json' }
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || '도서관 소식을 불러오지 못했습니다.');
      const notices = Array.isArray(data.notices) ? data.notices : [];
      if(notices.length){
        renderLibraryNews(notices);
        if(currentRecommendation) currentRecommendation = { ...currentRecommendation, notices };
      }else if(!currentItems.length){
        renderLibraryNews([]);
      }
    }catch(error){
      console.warn('Library news refresh failed', error);
      if(!currentItems.length) renderLibraryNews([]);
    }
  }
  function formatInstagramDate(value){
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone:'Asia/Seoul',
      month:'2-digit',
      day:'2-digit'
    }).format(date);
  }
  function formatInstagramNumber(value){
    if(value === null || value === undefined || value === '') return '-';
    const number = Number(value);
    if(!Number.isFinite(number)) return '-';
    return new Intl.NumberFormat('ko-KR', {
      notation:number >= 10000 ? 'compact' : 'standard'
    }).format(number);
  }
  function instagramTypeLabel(value){
    if(value === 'VIDEO') return 'VIDEO';
    if(value === 'REELS') return 'REELS';
    if(value === 'CAROUSEL_ALBUM') return 'ALBUM';
    return 'POST';
  }
  function renderInstagramProfile(profile){
    if(!els.instagramProfileName) return;
    const data = profile || {};
    els.instagramProfileName.textContent = data.username || 'dongalibrary';
    if(els.instagramProfilePhoto) els.instagramProfilePhoto.src = data.profilePictureUrl || 'img/instagram.png';
    if(els.instagramPostCount) els.instagramPostCount.textContent = formatInstagramNumber(data.mediaCount);
    if(els.instagramFollowerCount) els.instagramFollowerCount.textContent = formatInstagramNumber(data.followersCount);
    if(els.instagramFollowingCount) els.instagramFollowingCount.textContent = formatInstagramNumber(data.followsCount);
  }
  function renderInstagramFeed(items, options = {}){
    if(!els.instagramFeed) return;
    els.instagramFeed.innerHTML = '';
    const posts = items || [];
    if(!posts.length){
      const empty = document.createElement('div');
      empty.className = 'instagram-empty';
      empty.textContent = options.message || 'Instagram 피드를 불러오지 못했습니다.';
      els.instagramFeed.appendChild(empty);
      return;
    }
    posts.slice(0, 6).forEach((post)=>{
      const link = document.createElement('a');
      link.className = 'instagram-card';
      link.href = post.permalink || 'https://www.instagram.com/dongalibrary/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const imageUrl = String(post.thumbnailUrl || post.mediaUrl || '').trim();
      link.innerHTML = `
        <span class="instagram-media">
          <img alt="" loading="lazy">
          <span class="instagram-badge"></span>
        </span>
        <span class="instagram-copy">
          <small></small>
          <strong></strong>
        </span>
      `;
      const image = link.querySelector('img');
      if(imageUrl){
        image.src = imageUrl;
        image.addEventListener('error', ()=>{
          link.classList.add('no-thumb');
          image.removeAttribute('src');
        }, { once:true });
      }else{
        link.classList.add('no-thumb');
      }
      const caption = String(post.caption || '').trim();
      link.querySelector('.instagram-badge').textContent = instagramTypeLabel(post.mediaType);
      link.querySelector('small').textContent = [post.username ? `@${post.username}` : '@dongalibrary', formatInstagramDate(post.timestamp)].filter(Boolean).join(' · ');
      link.querySelector('strong').textContent = caption || '도서관 인스타그램 게시물';
      els.instagramFeed.appendChild(link);
    });
  }
  async function refreshInstagramFeed(){
    if(!els.instagramFeed) return;
    renderInstagramFeed([], { message:'Instagram 피드를 확인하는 중입니다.' });
    try{
      const res = await fetch(`/.netlify/functions/instagram-feed?limit=6&_=${Date.now()}`, {
        cache:'no-store',
        headers:{ accept:'application/json' }
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || 'Instagram 피드를 불러오지 못했습니다.');
      const items = Array.isArray(data.items) ? data.items : [];
      renderInstagramProfile(data.profile);
      if(items.length){
        renderInstagramFeed(items);
      }else{
        renderInstagramFeed([], { message:data.configured === false ? 'Instagram 연동 준비 중입니다.' : '표시할 Instagram 게시물이 없습니다.' });
      }
    }catch(error){
      console.warn('Instagram feed refresh failed', error);
      renderInstagramFeed([]);
    }
  }
  function serviceUrl(){
    return window.location.origin + window.location.pathname;
  }
  function setEmailStatus(message, isError = false){
    if(!els.emailStatus) return;
    els.emailStatus.textContent = message || '';
    els.emailStatus.classList.toggle('is-error', Boolean(isError));
  }
  function resetEmailForm(){
    if(els.emailResultModal) els.emailResultModal.hidden = true;
    if(els.resultEmailLocal) els.resultEmailLocal.value = '';
    if(els.resultEmailDomain) els.resultEmailDomain.value = '@gmail.com';
    setEmailStatus('');
  }
  function openEmailModal(){
    if(!els.emailResultModal) return;
    els.emailResultModal.hidden = false;
    setEmailStatus('');
    if(els.resultEmailLocal) els.resultEmailLocal.focus();
  }
  function closeEmailModal(){
    if(!els.emailResultModal) return;
    els.emailResultModal.hidden = true;
    setEmailStatus('');
  }
  function composedEmail(){
    const local = els.resultEmailLocal ? els.resultEmailLocal.value.trim() : '';
    if(local.includes('@')) return local;
    const domainValue = els.resultEmailDomain ? els.resultEmailDomain.value : '';
    const domain = domainValue.replace(/^@/, '');
    return local && domain ? `${local}@${domain}` : '';
  }
  async function sendResultEmail(event){
    event.preventDefault();
    if(!currentRecommendation){
      setEmailStatus('메일로 보낼 추천 결과가 없습니다. 먼저 추천을 받아주세요.', true);
      return;
    }

    const email = composedEmail();
    if(!email){
      setEmailStatus('이메일 주소를 입력해 주세요.', true);
      return;
    }

    const originalText = els.sendEmailBtn ? els.sendEmailBtn.textContent : '';
    if(els.sendEmailBtn){
      els.sendEmailBtn.disabled = true;
      els.sendEmailBtn.textContent = '보내는 중';
    }
    setEmailStatus('결과 링크를 만들고 메일을 보내는 중입니다.');

    try{
      const res = await fetch('/.netlify/functions/email-result', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ email, result:currentRecommendation })
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || '메일을 보내지 못했습니다.');
      setEmailStatus('메일을 보냈습니다. 받은 편지함을 확인해 주세요.');
    }catch(error){
      setEmailStatus(error.message || '메일을 보내지 못했습니다.', true);
    }finally{
      if(els.sendEmailBtn){
        els.sendEmailBtn.disabled = false;
        els.sendEmailBtn.textContent = originalText;
      }
    }
  }
  function showSharedResultError(message){
    currentRecommendation = null;
    els.startView.hidden = true;
    els.quizView.hidden = true;
    els.loadingView.setAttribute('aria-hidden','true');
    els.resultsView.setAttribute('aria-hidden','false');
    setAuraClass(els.resultHero, 'aura-balanced');
    renderResultTitle('공유 결과를 불러오지 못했습니다');
    els.resultSummary.textContent = '일주일 보관 기간이 지났거나 링크가 올바르지 않습니다. 새 추천을 받아 다시 공유해 주세요.';
    renderMainBooks([]);
    renderAladinBestSellers([]);
    renderPopularBooks([]);
    renderLibraryNews([]);
    renderLibraryInstructions([]);
    resetEmailForm();
    if(els.printResultBtn) els.printResultBtn.disabled = true;
    setError(els.resultError, message || '공유 결과를 불러오지 못했습니다.');
    window.scrollTo({top:0, behavior:'smooth'});
  }
  async function loadSharedResultFromUrl(){
    const id = new URLSearchParams(window.location.search).get('resultId');
    if(!id) return false;

    els.startView.hidden = true;
    els.quizView.hidden = true;
    els.resultsView.setAttribute('aria-hidden','true');
    els.loadingView.setAttribute('aria-hidden','false');
    els.stepPill.textContent = '공유 결과';
    try{
      const res = await fetch(`/.netlify/functions/shared-result?id=${encodeURIComponent(id)}`, {
        headers:{ accept:'application/json' }
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || '공유 결과를 불러오지 못했습니다.');
      renderResults(data.result);
      els.stepPill.textContent = '공유 결과';
    }catch(error){
      showSharedResultError(error.message);
    }
    return true;
  }
  function renderResults(data){
    currentRecommendation = data || null;
    const leadBook = data.items && data.items[0];
    const resultAura = auraClassFor([data.shelfTitle, data.summary, leadBook && leadBook.matchedTags, leadBook && leadBook.collection, leadBook && leadBook.title]);
    setAuraClass(els.resultHero, resultAura);
    els.startView.hidden = true;
    els.quizView.hidden = true;
    els.loadingView.setAttribute('aria-hidden','true');
    els.resultsView.setAttribute('aria-hidden','false');
    setError(els.resultError, '');
    resetEmailForm();
    renderResultTitle(data.shelfTitle || 'AI가 건네는 책');
    if(els.printResultBtn) els.printResultBtn.disabled = !(data.items && data.items.length);
    els.resultSummary.textContent = data.items && data.items.length
      ? 'AI가 당신의 답변을 바탕으로 취향에 맞는 추천도서를 준비했습니다. 당신에게 도움이 될 다양한 정보도 함께 준비했으니, 지금 확인해보세요.'
      : '추천 결과를 만들지 못했습니다.';
    renderMainBooks(data.items || []);
    rememberRecommendedBooks(data.items || []);
    renderAladinBestSellers(data.aladinBestSellers || []);
    renderPopularBooks(data.popularItems || []);
    renderLibraryNews(data.notices || []);
    refreshLibraryNews(data.notices || []);
    refreshInstagramFeed();
    if(!(data.items || []).length){
      setError(els.resultError, '추천할 수 있는 도서를 찾지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    }
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function startQuiz(){
    if(!QUESTIONS.length) return;
    els.startView.hidden = true;
    els.quizView.hidden = false;
    els.loadingView.setAttribute('aria-hidden','true');
    els.resultsView.setAttribute('aria-hidden','true');
    els.stepPill.textContent = `AI 1 / ${QUESTIONS.length}`;
    renderQuestion();
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function showStartView(){
    cancelRecommendationRequest();
    state.index = 0;
    state.answers = {};
    currentRecommendation = null;
    if(new URLSearchParams(window.location.search).has('resultId')){
      window.history.replaceState(null, '', serviceUrl());
    }
    els.resultsView.setAttribute('aria-hidden','true');
    els.loadingView.setAttribute('aria-hidden','true');
    els.startView.hidden = false;
    els.quizView.hidden = true;
    els.stepPill.textContent = '시작 전';
    if(els.questionTotalText) els.questionTotalText.textContent = `${QUESTIONS.length || 6}문항`;
    els.startBtn.disabled = !QUESTIONS.length;
    els.startBtn.textContent = QUESTIONS.length ? 'AI 추천 시작' : '질문 준비 중';
    if(els.printResultBtn) els.printResultBtn.disabled = true;
    setError(els.errorBox, '');
    setError(els.resultError, '');
    resetEmailForm();
    setAuraClass(els.resultHero, 'aura-balanced');
    window.scrollTo({top:0, behavior:'smooth'});
  }
  async function returnHomeWithFreshQuestions(){
    els.startBtn.disabled = true;
    els.startBtn.textContent = '질문 준비 중';
    showStartView();
    try{
      await refreshQuestionSet();
      els.startBtn.disabled = false;
      els.startBtn.textContent = 'AI 추천 시작';
    }catch(error){
      console.error(error);
      els.startBtn.textContent = '질문을 불러오지 못했습니다';
    }
  }

  window.startQuiz = startQuiz;
  els.startBtn.disabled = true;
  els.startBtn.textContent = '질문 준비 중';
  loadSharedResultFromUrl();
  loadQuestionSet()
    .then(()=>{
      els.startBtn.disabled = false;
      els.startBtn.textContent = 'AI 추천 시작';
    })
    .catch(error=>{
      console.error(error);
      els.startBtn.textContent = '질문을 불러오지 못했습니다';
    });
  els.startBtn.addEventListener('click', ()=>{
    trackAiRecommendationStart();
    startQuiz();
  });
  if(els.homeBtn){
    els.homeBtn.addEventListener('click', returnHomeWithFreshQuestions);
  }
  if(els.emailResultBtn){
    els.emailResultBtn.addEventListener('click', openEmailModal);
  }
  if(els.printResultBtn){
    els.printResultBtn.addEventListener('click', printRecommendationList);
  }
  if(els.emailResultForm){
    els.emailResultForm.addEventListener('submit', sendResultEmail);
  }
  document.querySelectorAll('[data-email-close]').forEach(button=>{
    button.addEventListener('click', closeEmailModal);
  });
  document.addEventListener('keydown', event=>{
    if(event.key === 'Escape' && els.emailResultModal && !els.emailResultModal.hidden){
      closeEmailModal();
    }
  });
  els.prevBtn.addEventListener('click', ()=>{
    if(state.index > 0){ state.index -= 1; renderQuestion(); }
  });
  els.restartBtn.addEventListener('click', async ()=>{
    els.restartBtn.disabled = true;
    try{
      await refreshQuestionSet();
      showStartView();
    }catch(error){
      setError(els.resultError, error.message || '질문을 다시 불러오지 못했습니다.');
    }finally{
      els.restartBtn.disabled = false;
    }
  });
});
