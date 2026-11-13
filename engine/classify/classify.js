// INFINI AI — result classification.
// Every document a question brings in is sorted along several independent axes, by explicit rules:
//   who published it (kind of source) · what kind of document it is · study design (scholarly work) · how old it is ·
//   where it comes from · how reliable that kind of source usually is · how much of it was read · how relevant it was ·
//   which way it leans (yes/no questions) · which sub-topics it covers.
// The rules look at the address, the page's own metadata (schema.org types, Open Graph), its structure and its wording.
// They are heuristics: a label says what a document looks like, not that it is right. Nothing here contains answers.

import { hostOf, domainOf } from '../util/text.js';

const H = (list) => new RegExp(`(^|\\.)(${list.join('|').replace(/\./g, '\\.')})$`);
const FACTCHECK = H(['snopes.com', 'politifact.com', 'factcheck.org', 'fullfact.org', 'factcheck.afp.com', 'leadstories.com', 'africacheck.org', 'boomlive.in', 'altnews.in', 'healthfeedback.org', 'sciencefeedback.co', 'truthorfiction.com']);
const HEALTH = H(['mayoclinic.org', 'clevelandclinic.org', 'webmd.com', 'healthline.com', 'medicalnewstoday.com', 'hopkinsmedicine.org', 'verywellhealth.com', 'drugs.com', 'patient.info', 'msdmanuals.com', 'merckmanuals.com', 'uptodate.com', 'everydayhealth.com', 'medscape.com', 'cancer.org', 'heart.org', 'diabetes.org', 'kidshealth.org', 'health.com', 'examine.com', 'nutritionfacts.org', 'cochrane.org', 'cochranelibrary.com', 'aafp.org', 'bupa.co.uk', 'healthdirect.gov.au', 'mskcc.org', 'mdanderson.org', 'uofmhealth.org', 'pennmedicine.org']);
const DATA = H(['ourworldindata.org', 'statista.com', 'worldometers.info', 'tradingeconomics.com', 'macrotrends.net', 'gapminder.org', 'knoema.com', 'indexmundi.com', 'numbeo.com', 'data.worldbank.org', 'fred.stlouisfed.org', 'pewresearch.org', 'gallup.com', 'kff.org', 'iea.org', 'irena.org', 'ember-energy.org', 'ember-climate.org', 'sipri.org', 'unctad.org', 'data.gov', 'ec.europa.eu', 'eia.gov', 'bls.gov', 'census.gov', 'stats.oecd.org', 'worldpopulationreview.com', 'countryeconomy.com', 'theglobaleconomy.com']);
const LEGAL = H(['law.cornell.edu', 'eur-lex.europa.eu', 'legislation.gov.uk', 'federalregister.gov', 'congress.gov', 'justia.com', 'findlaw.com', 'courtlistener.com', 'oyez.org', 'supremecourt.gov', 'govinfo.gov', 'ecfr.gov', 'regulations.gov', 'legifrance.gouv.fr', 'gesetze-im-internet.de', 'lawcommission.gov.np', 'indiacode.nic.in', 'casetext.com', 'scotusblog.com', 'curia.europa.eu', 'wipo.int', 'uscode.house.gov']);
const NGO = H(['greenpeace.org', 'wwf.org', 'worldwildlife.org', 'amnesty.org', 'hrw.org', 'eff.org', 'oxfam.org', 'redcross.org', 'icrc.org', 'msf.org', 'savethechildren.org', 'nrdc.org', 'sierraclub.org', 'edf.org', 'ucsusa.org', 'aclu.org', 'transparency.org', 'earthjustice.org', 'ciel.org', 'ewg.org', 'foe.org', '350.org', 'unicefusa.org', 'care.org', 'rsf.org', 'cpj.org', 'plasticpollutioncoalition.org', 'oceanconservancy.org', 'nature.org', 'conservation.org', 'iucn.org', 'worldbenchmarkingalliance.org', 'fsf.org', 'opensource.org', 'creativecommons.org', 'mozilla.org', 'internetsociety.org', 'accessnow.org']);
const THINKTANK = H(['brookings.edu', 'rand.org', 'cfr.org', 'csis.org', 'chathamhouse.org', 'carnegieendowment.org', 'heritage.org', 'cato.org', 'aei.org', 'piie.com', 'bruegel.org', 'ifs.org.uk', 'urban.org', 'hoover.org', 'atlanticcouncil.org', 'wri.org', 'rff.org', 'rmi.org', 'mckinsey.com', 'weforum.org', 'nber.org', 'cepr.org', 'ecfr.eu', 'lowyinstitute.org', 'orfonline.org', 'iiss.org', 'stimson.org', 'newamerica.org', 'epi.org', 'taxfoundation.org', 'cbpp.org', 'resolutionfoundation.org', 'bcg.com', 'deloitte.com', 'pwc.com', 'gartner.com', 'energypolicy.columbia.edu', 'belfercenter.org']);
const LIBRARY = H(['archive.org', 'gutenberg.org', 'hathitrust.org', 'europeana.eu', 'jstor.org', 'worldcat.org', 'openlibrary.org', 'biodiversitylibrary.org', 'perseus.tufts.edu', 'sacred-texts.com', 'bartleby.com', 'poetryfoundation.org']);
const BLOGHOST = /(^|\.)(medium\.com|substack\.com|blogspot\.com|wordpress\.com|tumblr\.com|dev\.to|hashnode\.dev|ghost\.io|blogger\.com|livejournal\.com|github\.io|neocities\.org|bearblog\.dev|write\.as|typepad\.com|weebly\.com|wixsite\.com)$|^blogs?\./;
const SOCIAL = /(^|\.)(reddit\.com|quora\.com|x\.com|twitter\.com|facebook\.com|youtube\.com|tiktok\.com|instagram\.com|pinterest\.com|linkedin\.com|ycombinator\.com|lobste\.rs|discourse\.org|answers\.com|fandom\.com|everything2\.com|mastodon\.social|threads\.net|bsky\.app|4chan\.org|slashdot\.org|metafilter\.com|stackexchange\.com)$|^(forum|forums|community|discuss|talk|boards?)\./;
const DICTIONARY = H(['merriam-webster.com', 'dictionary.com', 'collinsdictionary.com', 'cambridge.org', 'oxfordlearnersdictionaries.com', 'vocabulary.com', 'thefreedictionary.com', 'etymonline.com', 'wiktionary.org', 'investopedia.com', 'techtarget.com', 'howstuffworks.com', 'khanacademy.org', 'byjus.com', 'geeksforgeeks.org', 'w3schools.com', 'tutorialspoint.com', 'javatpoint.com', 'programiz.com', 'realpython.com', 'freecodecamp.org', 'baeldung.com', 'digitalocean.com', 'thoughtco.com', 'sparknotes.com', 'biologyonline.com', 'chem.libretexts.org', 'libretexts.org', 'openstax.org', 'coursera.org', 'edx.org', 'study.com', 'history.com', 'worldhistory.org', 'plato.stanford.edu', 'iep.utm.edu', 'mathworld.wolfram.com', 'encyclopedia.com', 'newworldencyclopedia.org', 'citizendium.org', 'simple.wikipedia.org']);

export const SOURCE_KINDS = {
  gov: 'Government or official body', scholarly: 'Scholarly journal', preprint: 'Preprint server', academic: 'University or research institute', encyclopedia: 'Encyclopedia',
  reference: 'Reference or educational site', docs: 'Official documentation', news: 'News organisation', factcheck: 'Fact-checker', health: 'Medical information site',
  data: 'Data or statistics provider', legal: 'Law or regulation', thinktank: 'Think tank or consultancy', ngo: 'Non-profit or advocacy group', library: 'Library or archive',
  qa: 'Community Q&A', social: 'Forum or social platform', blog: 'Blog or personal site', company: 'Company or commercial site', org: 'Organisation (.org)', structured: 'Structured data', other: 'Other website',
};
export const DOC_KINDS = {
  meta: 'Meta-analysis or systematic review', review: 'Review article', research: 'Research article', preprint: 'Preprint', reference: 'Reference entry', news: 'News report', opinion: 'Opinion or editorial',
  explainer: 'Explainer or analysis', howto: 'How-to or tutorial', docs: 'Documentation', qa: 'Q&A thread', forum: 'Discussion thread', press: 'Press release', product: 'Product or marketing page',
  factcheck: 'Fact check', data: 'Statistics or data page', legal: 'Legal or regulatory text', faq: 'FAQ', list: 'List or roundup', report: 'Report or white paper', book: 'Book or chapter', interview: 'Interview',
  blog: 'Blog post', feed: 'News feed item', structured: 'Structured record', page: 'Web page',
};
export const STUDY_KINDS = ['meta-analysis', 'systematic review', 'randomised trial', 'clinical trial', 'guideline', 'observational study', 'case report', 'laboratory or animal study', 'review', 'preprint', 'commentary', 'research article'];

const CATEGORY_TO_KIND = { 'official / institutional': 'gov', scholarly: 'scholarly', preprint: 'preprint', 'official documentation': 'docs', encyclopedia: 'encyclopedia', 'academic institution': 'academic', 'news / journalism': 'news', 'community Q&A': 'qa', 'user-generated': 'social', 'news feed': 'news', 'structured data': 'structured' };

/** Who publishes this? Returns a key of SOURCE_KINDS. doc: {url, category, pageType, ldTypes, ogType, author, kind, provider} */
export function sourceKind(doc) {
  const host = hostOf(doc.url || ''), path = (() => { try { return new URL(doc.url).pathname.toLowerCase(); } catch { return ''; } })();
  if (doc.structured) return 'structured';
  if (FACTCHECK.test(host)) return 'factcheck';
  if (LEGAL.test(host)) return 'legal';
  if (DATA.test(host)) return 'data';
  if (HEALTH.test(host)) return 'health';
  if (THINKTANK.test(host)) return 'thinktank';
  if (doc.kind === 'academic' && doc.provider !== 'arxiv') return doc.scholar && doc.scholar.study === 'preprint' ? 'preprint' : 'scholarly';
  const known = CATEGORY_TO_KIND[doc.category];
  if (known && known !== 'social') return known;
  if (DICTIONARY.test(host)) return 'reference';
  if (NGO.test(host)) return 'ngo';
  if (LIBRARY.test(host)) return 'library';
  if (BLOGHOST.test(host)) return 'blog';
  if (known === 'social' || SOCIAL.test(host)) return 'social';
  const types = (doc.ldTypes || []).join(' ');
  if (/newsarticle|reportagenewsarticle|newsmediaorganization/.test(types) || doc.pageType === 'news') return 'news';
  if (/^\/(blog|blogs|posts?)\//.test(path) && !/product|corporation/.test(types)) return doc.author ? 'blog' : 'company';
  if (doc.pageType === 'blog') return 'blog';
  if (/\b(product|offer|softwareapplication|store|localbusiness|corporation)\b/.test(types) || /^\/(products?|pricing|solutions|shop|store|services|platform|features|customers|demo)(\/|$)/.test(path)) return 'company';
  if (/\.org$|\.org\.[a-z]{2}$/.test(host)) return 'org';
  if (/\.(com|io|co|ai|app|biz|net|tech|inc|ltd)$|\.co\.[a-z]{2}$|\.com\.[a-z]{2}$/.test(host)) return 'company';
  return 'other';
}

const T = {
  meta: /\b(meta-?analys[ie]s|systematic review|umbrella review|pooled analysis|scoping review)\b/i,
  review: /\b(a review|review of|literature review|narrative review|state of the art|an overview|current (insights|perspectives|knowledge|understanding)|recent advances)\b/i,
  trial: /\b(randomi[sz]ed|placebo[- ]controlled|double[- ]blind|controlled trial|clinical trial|phase (i|ii|iii|1|2|3) (trial|study))\b/i,
  observational: /\b(cohort|cross-sectional|case-control|longitudinal|prospective|retrospective|observational|population-based|survey of|registry)\b/i,
  lab: /\b(in vitro|in vivo|in mice|in rats|mouse model|murine|zebrafish|cell lines?|cultured cells|drosophila|c\. elegans|animal (model|stud)|rodents?)\b/i,
  caseReport: /\bcase (report|series)\b/i, guideline: /\b(guidelines?|consensus statement|position (statement|paper)|recommendations? (of|from) the)\b/i,
  howto: /^(how to|how do (i|you)|a? ?(step[- ]by[- ]step|beginner'?s?|complete|ultimate|quick|practical|definitive) guide|guide to|tutorial|getting started|introduction to)\b|\b(tutorial|step[- ]by[- ]step|walkthrough|cheat ?sheet|how-to)\b/i,
  list: /^(the )?(top|best|worst)?\s?\d{1,3}\s+(best|top|worst|most|ways|tips|things|reasons|facts|examples|types|signs|benefits|foods|tools|books|myths|steps|mistakes|ideas|surprising|common|simple|easy|key|important|essential|great|amazing|proven)\b|^(top|best) \d{1,3}\b/i,
  opinion: /^(opinion|op-ed|editorial|commentary|comment|column|viewpoint|perspective|letters?( to the editor)?)\s*[:|–—-]|\b(opinion|op-ed|editorial)\b\s*[|–—-]|\bwhy (i|we) (think|believe)\b/i,
  press: /\b(press release|news release|media release|for immediate release|announces|announced today)\b/i,
  interview: /\b(interview with|in conversation with|q&a with|q & a with|a conversation with|speaks to|talks to)\b/i,
  explainer: /^(what (is|are|was|were|does|do)|why (is|are|do|does|did)|how (does|do|did|is|are)|who (is|was|are)|when (is|was|did)|understanding|explained|the (science|history|truth|facts|basics|story) (of|behind|about))\b|\b(explained|explainer|everything you need to know|what you need to know|what to know|a primer|101|faq|frequently asked|myths and facts|facts about|pros and cons|vs\.?|versus)\b/i,
  factcheck: /\b(fact[- ]check|fact check|debunk(ed|ing)?|false claim|misleading claim|did .* really)\b/i,
  report: /\b(annual report|white ?paper|technical report|working paper|policy brief|briefing|assessment report|status report|outlook 20\d\d|report 20\d\d|global report|state of the)\b/i,
  data: /\b(statistics|by the numbers|in numbers|data (set|portal|explorer)|dataset|figures|rankings?|index 20\d\d|database|chart|charts)\b/i,
  faq: /\b(faqs?|frequently asked questions|questions and answers|common questions)\b/i,
};
const P = {
  opinion: /\/(opinions?|op-?ed|editorials?|commentary|comment|columns?|columnists?|viewpoints?|perspectives?|voices|letters|commentisfree|blogs?\/opinion)(\/|$)/,
  news: /\/(news|world|politics|business|national|international|latest|breaking|article|articles|story|stories|headlines|20\d\d\/\d{1,2}\/\d{1,2})(\/|$)|\/20\d\d\/\d{2}\//,
  press: /\/(press(-|_)?releases?|press|newsroom|media(-|_)?(center|centre|releases?)|news-releases?|pressroom|announcements)(\/|$)/,
  howto: /\/(how-?to|tutorials?|guides?|learn|getting-started|quickstart|cookbook|recipes?|walkthroughs?|lessons?|courses?)(\/|$)/,
  docs: /\/(docs?|documentation|manual|reference|api|handbook|man|help|support|kb|knowledge-?base|wiki)(\/|$)/,
  faq: /\/(faqs?|frequently-asked-questions|questions)(\/|$)/,
  product: /\/(products?|pricing|solutions|shop|store|buy|plans|features|services|platform|demo|customers|case-stud(y|ies))(\/|$)/,
  report: /\/(reports?|publications?|white-?papers?|research|briefs?|working-papers?|insights|studies|analysis)(\/|$)/,
  blog: /\/(blogs?|posts?|journal|notes|diary|weblog)(\/|$)/,
  data: /\/(data|statistics|stats|datasets?|indicators?|charts?|graphs?|rankings?|tables?)(\/|$)/,
  forum: /\/(forums?|threads?|topic|topics|discussion|discussions|community|boards?|comments|t|r|viewtopic)(\/|$)|showthread|viewtopic/,
  legal: /\/(law|laws|legal|legislation|statutes?|regulations?|codes?|acts?|bills?|cases?|opinions|rulings?|treat(y|ies)|directives?|uscode|cfr)(\/|$)/,
  book: /\/(books?|chapters?|ebooks?|textbooks?|monographs?)(\/|$)/,
};

/** Study design of a scholarly work, from publication types reported by the index and from the wording of title and abstract. */
export function studyKind(doc) {
  const given = doc.scholar && doc.scholar.study;
  const text = `${doc.title || ''} ${(doc.blocks || []).slice(0, 2).map((b) => b.text || '').join(' ').slice(0, 1200)}`;
  if (given === 'meta-analysis' || /\bmeta-?analys[ie]s\b/i.test(doc.title || '')) return 'meta-analysis';
  if (given === 'systematic review' || T.meta.test(doc.title || '')) return 'systematic review';
  if (given === 'randomised trial' || given === 'clinical trial') return given;
  if (given === 'guideline' || given === 'case report' || given === 'preprint' || given === 'commentary') return given;
  if (T.trial.test(text)) return /randomi[sz]ed/i.test(text) ? 'randomised trial' : 'clinical trial';
  if (T.caseReport.test(doc.title || '')) return 'case report';
  if (given === 'review' || T.review.test(doc.title || '')) return 'review';
  if (T.lab.test(text)) return 'laboratory or animal study';
  if (T.observational.test(text) || given === 'observational study') return 'observational study';
  if (T.guideline.test(doc.title || '')) return 'guideline';
  return 'research article';
}

/** What kind of document is this? Returns a key of DOC_KINDS. `kind` is the result of sourceKind(doc). */
export function docKind(doc, kind) {
  const title = String(doc.title || '').trim(), types = (doc.ldTypes || []).join(' ');
  const path = (() => { try { return new URL(doc.url).pathname.toLowerCase(); } catch { return ''; } })();
  const st = doc.stats || {};
  if (doc.structured) return 'structured';
  if (doc.news && doc.evidenceLevel === 'feed') return 'feed';
  if (kind === 'scholarly' || kind === 'preprint' || doc.pageType === 'scholarly' || /scholarlyarticle|medicalscholarlyarticle/.test(types)) {
    const s = studyKind(doc);
    if (s === 'meta-analysis' || s === 'systematic review') return 'meta';
    if (kind === 'preprint' || s === 'preprint') return 'preprint';
    if (s === 'review' || s === 'guideline') return 'review';
    if (/book|chapter/i.test((doc.scholar && doc.scholar.type) || '')) return 'book';
    return 'research';
  }
  if (kind === 'factcheck' || T.factcheck.test(title) || /claimreview/.test(types)) return 'factcheck';
  if (kind === 'qa' || doc.pageType === 'qa' || /qapage/.test(types)) return 'qa';
  if (kind === 'encyclopedia') return 'reference';
  if (kind === 'docs') return P.howto.test(path) || T.howto.test(title) ? 'howto' : 'docs';
  if (kind === 'legal' || (kind === 'gov' && P.legal.test(path))) return 'legal';
  if (P.press.test(path) || (T.press.test(title) && kind !== 'news')) return 'press';
  if (P.opinion.test(path) || T.opinion.test(title) || /opinionnewsarticle|\breview\b/.test(types) && kind === 'news') return 'opinion';
  if (T.interview.test(title)) return 'interview';
  if (doc.pageType === 'faq' || /faqpage/.test(types) || P.faq.test(path) || T.faq.test(title) || (st.questions >= 4 && st.questions >= (st.paragraphs || 0) / 6)) return 'faq';
  if (doc.pageType === 'howto' || /howto|recipe/.test(types) || T.howto.test(title) || P.howto.test(path) || (st.orderedLists >= 1 && st.code >= 1)) return 'howto';
  if (T.list.test(title)) return 'list';
  if (kind === 'social' || P.forum.test(path) || /discussionforumposting|socialmediaposting/.test(types)) return 'forum';
  if (/\b(product|offer|softwareapplication)\b/.test(types) || (kind === 'company' && P.product.test(path))) return 'product';
  if (kind === 'data' || (T.data.test(title) && (st.tables >= 1 || P.data.test(path)))) return 'data';
  if (/\breport\b/.test(types) || T.report.test(title) || ((kind === 'gov' || kind === 'thinktank' || kind === 'ngo' || kind === 'org') && P.report.test(path))) return 'report';
  if (kind === 'news' || doc.pageType === 'news' || /newsarticle/.test(types)) return T.explainer.test(title) ? 'explainer' : 'news';
  if (P.book.test(path) || /\bbook\b|chapter/.test(types)) return 'book';
  if (kind === 'reference' || kind === 'health') return 'reference';
  if (T.explainer.test(title)) return 'explainer';
  if (kind === 'blog' || doc.pageType === 'blog' || /blogposting/.test(types) || P.blog.test(path)) return 'blog';
  if (P.docs.test(path) && st.code >= 1) return 'docs';
  if (P.news.test(path) && doc.published) return 'news';
  if (doc.pageType === 'article' || /\barticle\b/.test(types)) return 'explainer';
  return 'page';
}

let REGION = null;
const GENERIC_TLD = new Set(['com', 'org', 'net', 'info', 'io', 'co', 'ai', 'app', 'dev', 'me', 'tv', 'cc', 'ly', 'fm', 'to', 'gg', 'xyz', 'online', 'site', 'tech', 'blog', 'news', 'biz', 'science', 'earth', 'world', 'health', 'media']);
/** Where a site is based, as far as its address says: a country-code domain, or the United States for .gov/.mil/.edu. */
export function regionOf(url) {
  const host = hostOf(url);
  const tld = host.split('.').pop() || '';
  if (tld === 'gov' || tld === 'mil' || tld === 'edu') return 'United States';
  if (tld === 'eu' || /(^|\.)europa\.eu$/.test(host)) return 'European Union';
  if (tld === 'int' || /(^|\.)(un\.org|who\.int|worldbank\.org|imf\.org|oecd\.org)$/.test(host)) return 'International body';
  if (tld === 'uk') return 'United Kingdom';
  if (tld.length !== 2 || GENERIC_TLD.has(tld)) return '';
  try { REGION = REGION || new Intl.DisplayNames(['en'], { type: 'region' }); const n = REGION.of(tld.toUpperCase()); return n && n.toUpperCase() !== tld.toUpperCase() ? n : ''; } catch { return ''; }
}

export function yearOf(doc) { const m = String(doc.published || doc.modified || '').match(/^(\d{4})/); const y = m ? Number(m[1]) : doc.scholar && doc.scholar.year ? doc.scholar.year : 0; return y >= 1500 && y <= 2200 ? y : 0; }
export function recencyOf(doc, now = Date.now()) {
  const t = Date.parse(doc.published || doc.modified || '');
  if (!Number.isFinite(t)) { const y = yearOf(doc); if (!y) return 'undated'; const age = new Date(now).getUTCFullYear() - y; return age <= 0 ? 'this year' : age <= 2 ? '1–2 years old' : age <= 5 ? '3–5 years old' : age <= 10 ? '6–10 years old' : 'older than 10 years'; }
  const days = (now - t) / 86400000;
  return days <= 31 ? 'last 30 days' : days <= 366 ? 'last 12 months' : days <= 3 * 365 ? '1–2 years old' : days <= 6 * 365 ? '3–5 years old' : days <= 11 * 365 ? '6–10 years old' : 'older than 10 years';
}
export const RECENCY_ORDER = ['last 30 days', 'last 12 months', 'this year', '1–2 years old', '3–5 years old', '6–10 years old', 'older than 10 years', 'undated'];
export function reliabilityOf(q) { return q >= 0.8 ? 'A · high' : q >= 0.65 ? 'B · good' : q >= 0.5 ? 'C · unrated' : 'D · low'; }
export const RELIABILITY_NOTE = { 'A · high': 'official bodies, peer-reviewed journals, documentation, encyclopedias', 'B · good': 'established news organisations, preprints, community answers with a strong record', 'C · unrated': 'sites the rules cannot place', 'D · low': 'user-generated pages and pages that were hard to read' };
export function accessOf(doc) { return doc.structured ? 'structured data' : doc.evidenceLevel === 'feed' && !doc.verified ? 'feed summary only' : doc.partial ? 'abstract or summary only' : 'full text read'; }

/** Light page statistics for a document kept whole (digested pages carry theirs already). */
export function pageStats(doc) {
  const st = { paragraphs: 0, lists: 0, orderedLists: 0, tables: 0, code: 0, questions: 0 };
  for (const b of doc.blocks || []) {
    if (b.type === 'p') st.paragraphs++; else if (b.type === 'list') { st.lists++; if (b.ordered) st.orderedLists++; } else if (b.type === 'table') st.tables++; else if (b.type === 'code') st.code++;
    else if (b.type === 'heading' && /\?\s*$/.test(b.text || '')) st.questions++;
  }
  return st;
}

/** Classify one document on the question-independent axes. */
export function classifyDoc(doc, now = Date.now()) {
  if (!doc.stats && doc.blocks && doc.blocks.length) doc.stats = pageStats(doc);
  const kind = sourceKind(doc);
  const dk = docKind(doc, kind);
  return { source: kind, doc: dk, study: dk === 'meta' || dk === 'review' || dk === 'research' || dk === 'preprint' ? studyKind(doc) : '', year: yearOf(doc), recency: recencyOf(doc, now), region: regionOf(doc.url || ''), reliability: reliabilityOf(doc.quality == null ? 0.5 : doc.quality), access: accessOf(doc), lang: String(doc.lang || '').slice(0, 2).toLowerCase() };
}

const NEGATION = /\b(not|no|never|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|unable|impossible|false|myth|incorrect|untrue|debunked|misconception|contrary to|no evidence|little evidence|lack of evidence|unlikely|does not|do not|did not|is not|are not)\b/i;
const QUALIFIED = /\b(disput\w*|controvers\w*|contested|debated|mixed (results|evidence|findings)|inconclusive|unclear|uncertain|limited evidence|insufficient evidence|more research|further research|depends on|conflicting|preliminary|not (yet|fully|well) (known|understood|established)|remains? to be (seen|determined|established)|jury is still out)\b/i;
/** Which way a statement leans on a yes/no question (by its wording only): 'supports' | 'contradicts' | 'qualified'. */
export function stanceOf(text, negatedQuestion = false) {
  if (QUALIFIED.test(text) && !/\b(no evidence|debunked|myth|false)\b/i.test(text)) return 'qualified';
  // "not only … but also", "no doubt", "not just", "no less than", "no longer than" affirm; a negation inside an "although …" clause belongs to the concession, not to the claim
  const main = String(text).replace(/\b(?:not only|not just|not merely|not least|no doubt|no wonder|no less than|no fewer than|no more than|no longer than|not to mention|if not|whether or not|or not)\b/gi, ' ')
    .replace(/[,;]\s*(?:al)?though\b[^.;]*/gi, ' ').replace(/[,;]\s*(?:but|however)\s+(?:it is|this is|that is)?\s*not (?:clear|known|certain)[^.;]*/gi, ' ')
    // "… results in weight loss but with no significant effects on other parameters": the negation is about something else
    .replace(/[,;]?\s*\b(?:but|though|while|whereas|yet)\b(?=[^.;]*\b(?:other|another|additional|further|secondary)\b)[^.;]*/gi, ' ')
    // a negation inside a condition ("… occurs if intake is not sufficient to compensate", "unless it is not followed") states when the claim holds, it does not deny it
    .replace(/\b(?:if|when|whenever|unless|provided(?: that)?|as long as|so long as|until|where|in case)\b[^,.;]*/gi, ' ')
    // "without", "regardless of whether or not", "who do not …", "that are not …": the negation describes a group or a circumstance
    .replace(/\b(?:who|whom|whose|which|that)\s+(?:do|does|did|are|is|were|was|have|has|had|can|could|will|would)(?:\s+not|n't)\b[^,.;]*/gi, ' ');
  return NEGATION.test(main) !== negatedQuestion ? 'contradicts' : 'supports';
}

const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); } return m; };
const facet = (id, label, map, { labels = null, order = null, cited = null, note = '' } = {}) => {
  let values = [...map].map(([k, n]) => ({ id: k, label: labels ? labels[k] || k : k, count: n, ...(cited && cited.get(k) ? { cited: cited.get(k) } : {}) }));
  values = order ? values.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : values.sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  return { id, label, note, values };
};

/**
 * Build the classification of everything a question brought in.
 * docs: all documents; each may carry .cls (from classifyDoc), .rel (0..1), .sid (cited), .stance, .themes ([index into themes]).
 * Returns { totals, facets: [{id, label, values: [{id, label, count, cited?}]}], items: [...], themes }.
 */
export function buildClassification(docs, { now = Date.now(), themes = [], yesno = false, maxItems = 400, screened = 0, failed = 0, failures = null } = {}) {
  const live = docs.filter((d) => !d.wrongSense);
  for (const d of live) if (!d.cls) d.cls = classifyDoc(d, now);
  const relevant = live.filter((d) => !d.offTopic);
  const tier = (d) => (d.sid ? 'cited in the answer' : d.offTopic ? 'read, not relevant' : (d.rel == null ? 0.6 : d.rel) >= 0.6 ? 'relevant' : 'partly relevant');
  const citedBy = (key) => count(relevant.filter((d) => d.sid), key);
  const facets = [];
  const add = (f) => { if (f.values.length) facets.push(f); };
  add(facet('source', 'Kind of source', count(relevant, (d) => d.cls.source), { labels: SOURCE_KINDS, cited: citedBy((d) => d.cls.source) }));
  add(facet('doc', 'Kind of document', count(relevant, (d) => d.cls.doc), { labels: DOC_KINDS, cited: citedBy((d) => d.cls.doc) }));
  const studies = relevant.filter((d) => d.cls.study);
  if (studies.length >= 3) add(facet('study', 'Study design', count(studies, (d) => d.cls.study), { order: STUDY_KINDS, cited: citedBy((d) => d.cls.study), note: 'for scholarly works; from publication types and the wording of titles and abstracts' }));
  if (yesno) add(facet('stance', 'Which way it leans', count(relevant, (d) => d.stance || ''), { order: ['supports', 'qualified', 'contradicts'], labels: { supports: 'Leans yes', qualified: 'Qualified or uncertain', contradicts: 'Leans no' }, cited: citedBy((d) => d.stance || ''), note: 'read from the wording of the most relevant sentence in each source (negation and hedging terms)' }));
  if (themes.length) { const m = new Map(), c = new Map(); for (const d of relevant) for (const t of d.themes || []) { m.set(String(t), (m.get(String(t)) || 0) + 1); if (d.sid) c.set(String(t), (c.get(String(t)) || 0) + 1); } add(facet('theme', 'Sub-topic', m, { labels: Object.fromEntries(themes.map((t, i) => [String(i), t.label])), cited: c })); }
  add(facet('recency', 'Age', count(relevant, (d) => d.cls.recency), { order: RECENCY_ORDER, cited: citedBy((d) => d.cls.recency) }));
  add(facet('reliability', 'Reliability tier', count(relevant, (d) => d.cls.reliability), { order: Object.keys(RELIABILITY_NOTE), cited: citedBy((d) => d.cls.reliability), note: 'a rule-based rating of the kind of source, not a judgement of the individual page' }));
  add(facet('access', 'How much was read', count(relevant, (d) => d.cls.access), { cited: citedBy((d) => d.cls.access) }));
  const regions = count(relevant, (d) => d.cls.region);
  if (regions.size >= 2) add(facet('region', 'Country of the site', regions, { cited: citedBy((d) => d.cls.region), note: 'from country-code addresses only; .com, .org and similar say nothing about place' }));
  add(facet('relevance', 'Relevance', count(live, tier), { order: ['cited in the answer', 'relevant', 'partly relevant', 'read, not relevant'] }));
  // publication years (a compact histogram for the interface)
  const years = count(relevant, (d) => (d.cls.year ? String(d.cls.year) : ''));
  const timeline = [...years].map(([y, n]) => ({ year: Number(y), count: n })).sort((a, b) => a.year - b.year);
  const rank = (d) => (d.sid ? 2 : 0) + (d.offTopic ? -1 : 0) + (d.rel == null ? 0.6 : d.rel) * (0.6 + (d.quality == null ? 0.5 : d.quality));
  const items = [...live].sort((a, b) => rank(b) - rank(a)).slice(0, maxItems).map((d) => ({
    u: d.url, t: String(d.title || d.domain || '').slice(0, 140), d: d.domain || domainOf(d.url || ''), s: d.cls.source, k: d.cls.doc, ...(d.cls.study ? { st: d.cls.study } : {}), ...(d.cls.year ? { y: d.cls.year } : {}),
    r: Math.round((d.offTopic ? Math.min(0.33, d.rel || 0) : d.rel == null ? 0.6 : d.rel) * 100), q: Math.round((d.quality == null ? 0.5 : d.quality) * 100), a: d.cls.access, rc: d.cls.recency, rl: d.cls.reliability, ...(d.cls.region ? { g: d.cls.region } : {}),
    ...(d.sid ? { c: d.sid } : {}), ...(d.stance ? { z: d.stance } : {}), ...(d.themes && d.themes.length ? { th: d.themes.slice(0, 6) } : {}), ...(d.scholar && d.scholar.citedBy ? { cb: d.scholar.citedBy } : {}), tier: tier(d),
  }));
  const hosts = new Set(relevant.map((d) => d.domain)), origins = new Set(relevant.map((d) => d.origin));
  return {
    totals: { screened, documents: live.length, relevant: relevant.length, offTopic: live.length - relevant.length, fullText: relevant.filter((d) => d.cls.access === 'full text read').length, abstracts: relevant.filter((d) => d.cls.access === 'abstract or summary only').length, cited: relevant.filter((d) => d.sid).length, sites: hosts.size, origins: origins.size, failed, failures: failures || {}, listed: items.length },
    facets, timeline, items, themes: themes.map((t) => ({ label: t.label, from: t.source })),
  };
}
