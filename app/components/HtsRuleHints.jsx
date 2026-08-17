'use client';
import { useState, useEffect, useMemo } from "react";
import { SB } from "@/lib/supabase";

// ── HtsRuleHints ─────────────────────────────────────────────────────────────
// What CPSC rules an HTS code implies. DISPLAY ONLY -- it reads, it never writes.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ It is about the CODE, not about the product.                                │
// │                                                                             │
// │ A tariff code says what an article is FOR CUSTOMS. That narrows which rules  │
// │ could apply and settles none of them. Every string here says "this code      │
// │ implies" and never "this product requires" -- the difference is the whole    │
// │ point, and it is the sentence a reader will remember.                        │
// │                                                                             │
// │ Two things the code cannot tell you, both visible in real data:              │
// │                                                                             │
// │   AGE GRADE. 16 CFR 1610 needs a GCC for adult apparel and a CPC for         │
// │   children's. Nothing on a quote records an age grade, so the children's     │
// │   set is stated as a CONDITION and never as a fact.                          │
// │                                                                             │
// │   WHAT THE ARTICLE ACTUALLY IS. 9503 is the toy chapter, and one quote       │
// │   using it is a DOG toy -- a pet product no CPSC toy rule touches. The hint  │
// │   is still correct about the code. A person reading it is what catches the   │
// │   classification, which is the argument for display-only.                    │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Lives in app/components rather than inline in quotes.jsx because the same block is
// wanted on products once products.hts_code is populated -- it is null on all 271 today,
// which is why Quotes goes first: quotes.hts is set on 30 and the feature actually fires.
// Same reasoning that moved HtsField out of this file.

// The mapping, fetched once per host.
//
// hts_chapters is the REVIEWED list: a prefix present with no rules means "reviewed, no
// chapter-specific rules", which is a different statement from a prefix that is absent,
// meaning nobody has looked. The UI has to say those differently, so both are kept.
//
// 16 CFR 1260 is excluded HERE, in the query, rather than at the render. Its own note
// says the rule is stayed and under D.C. Circuit litigation and to verify enforcement
// before relying on it -- a rule that says "verify before relying on this" must never be
// suggested, and filtering at the source means no future caller can reintroduce it.
const EXCLUDED_CODES = ['16 CFR 1260'];

export function useHtsRuleMap() {
  const [chapters, setChapters] = useState([]);
  const [rules, setRules] = useState([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      SB.from('hts_chapters').select('prefix,childrens_set_applies,note'),
      SB.from('hts_chapter_rules').select('prefix,children_only,note,regulation:regulations(code,name)'),
    ]).then(([c, r]) => {
      if (!alive) return;
      // On error both stay empty and every code reads as unmapped. A failed fetch costs
      // the hint, never the quote.
      if (!c.error && c.data) setChapters(c.data);
      if (!r.error && r.data) setRules((r.data || []).filter(x => !EXCLUDED_CODES.includes(x.regulation?.code)));
    });
    return () => { alive = false; };
  }, []);
  return { chapters, rules };
}

// The children's set is not in hts_chapter_rules -- four rules across 28 chapters would
// be 112 near-identical rows. It hangs off hts_chapters.childrens_set_applies and is
// rendered as one conditional sentence rather than four rows, because it is the same
// four on almost every chapter and the condition is the only interesting part.
const CHILDRENS_SET = '15 USC 1278a, 16 CFR 1303, 16 CFR 1307, 16 CFR 1501';

export function HtsRuleHints({ code, chapters, rules, style }) {
  const digits = String(code || '').replace(/\D/g, '');

  // Longest matching prefix wins, so 9503 beats 95. That split is the reason the table is
  // keyed on 2 OR 4 characters: 9503 is toys and 9506 is sports equipment, and a
  // chapter-level rule would have put toy safety on a basketball hoop.
  const chapter = useMemo(() => {
    if (!digits) return null;
    const hits = chapters.filter(c => digits.startsWith(c.prefix));
    if (!hits.length) return null;
    return hits.reduce((a, b) => (b.prefix.length > a.prefix.length ? b : a));
  }, [digits, chapters]);

  const forChapter = useMemo(
    () => (chapter ? rules.filter(r => r.prefix === chapter.prefix) : []),
    [chapter, rules]
  );

  // Nothing at all without a code. A block reading "no code, so nothing is implied" would
  // sit on 255 of 285 quotes, and text on almost every row stops being read.
  if (!digits) return null;

  const wrap = { ...style, border: '1px solid #e7eaf0', borderRadius: 12, padding: '11px 13px', background: '#fbfcfe' };
  const head = { fontSize: 11.5, fontWeight: 600, color: '#3461e0', letterSpacing: '0.02em' };
  const sub = { fontSize: 11.5, color: '#6a7488', marginTop: 3, lineHeight: 1.5 };
  const row = { fontSize: 12.5, color: '#0f1729', marginTop: 7, lineHeight: 1.45 };
  const cond = { color: '#9aa3b5' };

  // Not mapped is an admission; reviewed-with-none is an answer this table earned. They
  // must not share copy.
  if (!chapter) {
    return (
      <div style={wrap}>
        <div style={head}>HTS {digits}</div>
        <div style={sub}>Chapter {digits.slice(0, 2)} is not mapped yet, so nothing is implied.</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={head}>{'HTS ' + digits + '  ·  chapter ' + chapter.prefix}</div>
      {chapter.note && <div style={sub}>{chapter.note}</div>}

      {forChapter.length === 0 ? (
        <div style={sub}>No chapter-specific CPSC rules for this chapter.</div>
      ) : (
        <>
          <div style={sub}>
            Rules this code implies. Suggestions from the tariff classification, not a determination —
            whether each applies depends on the article and its age grade.
          </div>
          {forChapter.map(r => (
            <div key={r.prefix + (r.regulation?.code || '')} style={row}>
              <b>{r.regulation?.code}</b>{r.regulation?.name ? ' — ' + r.regulation.name : ''}
              {/* children_only carries only the first of two conditions. 1615/1616 need a
                  children's product AND the item to actually BE sleepwear; the seed note
                  says so and this is where that reaches a reader.
                  COUPLED TO THE SEED PROSE: the caveat is chosen by looking for the word
                  "sleepwear" in hts_chapter_rules.note, so rewording those four notes
                  silently changes what renders. It holds because one rule pair has a
                  second condition. If more acquire one, this becomes a column on
                  hts_chapter_rules -- an article-type condition beside children_only --
                  not a longer regex. */}
              {r.children_only && <span style={cond}>{'  ·  ' + (r.note && /sleepwear/i.test(r.note) ? "children's products, and only if the item is sleepwear" : "children's products only")}</span>}
            </div>
          ))}
        </>
      )}

      {chapter.childrens_set_applies && (
        <div style={{ ...sub, marginTop: 8 }}>
          If this is a children&apos;s product, the children&apos;s set also applies: {CHILDRENS_SET}.
        </div>
      )}
    </div>
  );
}
