#!/usr/bin/env python
"""preflight.py -- rewritten 2026-09-18, the scratchpad copy having rolled over.

Lexes a hand-run SQL script and asserts, in one pass, the rules earned by scripts
14 through 60. Every rule here cost at least one rehearsal. Run it before printing
any script that a person will paste into a SQL editor by hand.

    python preflight.py 61-delete-duplicate-quote-TRE-011.sql

Exit 0 is a pass. Anything else prints the rule and the line.
"""
import sys

BS = chr(92)
APOS = chr(39)


def lex(text):
    """Yield (index, char, in_literal, in_comment) for the whole file.

    A single-quoted literal and a -- comment are tracked separately because the
    rules differ: apostrophes are illegal in comments, runs of spaces are illegal
    in literals. Dollar quoting is tracked so plpgsql bodies are not mistaken for
    string literals.
    """
    i, n = 0, len(text)
    in_lit = in_com = False
    dollar_tag = None
    while i < n:
        c = text[i]
        if dollar_tag:
            if text.startswith(dollar_tag, i):
                i += len(dollar_tag)
                dollar_tag = None
                continue
            yield i, c, False, False
            i += 1
            continue
        if not in_lit and not in_com and c == '$':
            end = text.find('$', i + 1)
            if end != -1 and text[i + 1:end].replace('_', '').isalnum() or (end == i + 1):
                dollar_tag = text[i:end + 1]
                i = end + 1
                continue
        if in_com:
            if c == '\n':
                in_com = False
            else:
                yield i, c, False, True
            i += 1
            continue
        if in_lit:
            if c == APOS:
                if i + 1 < n and text[i + 1] == APOS:
                    yield i, c, True, False
                    yield i + 1, text[i + 1], True, False
                    i += 2
                    continue
                in_lit = False
            else:
                yield i, c, True, False
            i += 1
            continue
        if c == APOS:
            in_lit = True
            i += 1
            continue
        if c == '-' and text.startswith('--', i):
            in_com = True
            i += 2
            continue
        yield i, c, False, False
        i += 1


def line_of(text, idx):
    return text.count('\n', 0, idx) + 1


def check(path):
    text = open(path, encoding='utf-8').read()
    fails = []
    toks = list(lex(text))

    # Rule: no backslash anywhere. Script 33 v2 lost one in transport.
    for i, c, lit, com in toks:
        if c == BS:
            fails.append((line_of(text, i), 'rule backslash', 'a backslash cannot survive the transport'))

    # Rule: no single colon anywhere, comments included. Double colon casts and
    # the plpgsql assignment operator are the two exceptions. Script 58 lost six
    # to a timestamp literal read as a bind parameter.
    for i, c, lit, com in toks:
        if c != ':':
            continue
        prev = text[i - 1] if i else ''
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if prev == ':' or nxt == ':' or nxt == '=':
            continue
        fails.append((line_of(text, i), 'rule single colon',
                      'a single colon is rewritten as a bind parameter'))

    # Rule: no apostrophe inside a -- comment. Script 23 opened a string that ran
    # past the newline and reported the error several lines later.
    for i, c, lit, com in toks:
        if com and c == APOS:
            fails.append((line_of(text, i), 'rule apostrophe in comment',
                          'rewrite the prose without the possessive'))

    # Rule: no run of two or more spaces inside a literal, and no embedded
    # newline. Both are eaten or reflowed by the layers in between.
    run = 0
    for i, c, lit, com in toks:
        if lit and c == ' ':
            run += 1
            if run == 2:
                fails.append((line_of(text, i), 'rule double space in literal',
                              'runs of spaces get collapsed in transport'))
        else:
            run = 0
        if lit and c == '\n':
            fails.append((line_of(text, i), 'rule newline in literal', 'literals must be one line'))

    # Rule 10: the column-list form of create temp table takes on commit drop
    # LAST. Both orders look right and only one parses.
    low = text.lower()
    pos = 0
    while True:
        pos = low.find('create temp table', pos)
        if pos == -1:
            break
        tail = low[pos:pos + 400]
        ocd = tail.find('on commit drop')
        if ocd != -1:
            # The ONLY bad form is the clause followed immediately by a column
            # list. The AS query form puts as next and is correct; the correct
            # column list form puts the clause last, so a semicolon follows.
            # An earlier version of this rule looked for any open paren after the
            # clause and failed both AS form tables in script 61, because the
            # first paren there belongs to the select body.
            rest = tail[ocd + len('on commit drop'):].lstrip()
            if rest.startswith('('):
                fails.append((line_of(text, pos), 'rule 10 on commit drop before a column list',
                              'the column list form takes the clause last'))
        pos += 1

    # Rule 4: the verification block must parse. Branch selects equal the union
    # all count plus one.
    body = text
    start = low.find('select * from (')
    if start == -1:
        fails.append((0, 'rule verification block', 'no select star from open paren found'))
    else:
        body = text[start:]
        unions = body.lower().count('union all')
        branches = body.lower().count('select ') - 1  # the wrapper select itself
        # sub-selects inside got expressions inflate the count, so compare the
        # branch markers instead: every branch after the first follows a union all
        if unions + 1 < 2:
            fails.append((line_of(text, start), 'rule verification block', 'fewer than two branches'))

        # Rule 1: the first branch aliases all three columns.
        first = body[:body.lower().find('union all')] if unions else body
        for alias in (' as chk', ' as got', ' as want'):
            if alias not in first.lower():
                fails.append((line_of(text, start), 'rule 1 first branch aliases',
                              'the first branch is missing' + alias))

        # Rule 7: every got sub-select carries a cast, a string_agg or a
        # concatenation, or a UNION type mismatch takes down the whole statement.
        seg = body.lower().split('union all')
        for k, s in enumerate(seg):
            if 'z0 verification ran' in s or 'select * from (' in s and k == 0 and 'as got' not in s:
                continue
            if '::text' not in s and 'string_agg' not in s and '||' not in s and "'" in s:
                if 'as got' in s or k > 0:
                    fails.append((0, 'rule 7 got needs a text cast',
                                  'branch ' + str(k) + ' has no cast, string_agg or concatenation'))

    # Rule: commit commented out, file ends in rollback.
    if '\ncommit;' in text:
        fails.append((line_of(text, text.find('\ncommit;')), 'rule commit must be commented out', ''))
    if not text.rstrip().endswith('rollback;'):
        fails.append((0, 'rule ends in rollback', 'the file must end in rollback'))

    # Rule 9: no absence check its own body satisfies.
    p = 0
    while True:
        p = low.find('position(', p)
        if p == -1:
            break
        frag = text[p:p + 200]
        if ') = 0' in frag:
            q1 = frag.find(APOS)
            q2 = frag.find(APOS, q1 + 1)
            if q1 != -1 and q2 != -1:
                needle = frag[q1 + 1:q2]
                if needle and text.count(needle) > 1:
                    fails.append((line_of(text, p), 'rule 9 absence check',
                                  'the string ' + needle + ' also appears elsewhere in the file'))
        p += 1

    return fails


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: preflight.py <file.sql>')
        sys.exit(2)
    target = sys.argv[1]
    problems = check(target)
    if not problems:
        print('PASS ' + target)
        sys.exit(0)
    seen = set()
    for ln, rule, detail in problems:
        key = (ln, rule)
        if key in seen:
            continue
        seen.add(key)
        print('line ' + str(ln) + '  ' + rule + ('  -- ' + detail if detail else ''))
    print(str(len(seen)) + ' problem(s)')
    sys.exit(1)
