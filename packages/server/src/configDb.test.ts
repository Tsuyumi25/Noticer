import { describe, expect, it } from 'vitest'
import { emptyConfig, type RawConfig } from './config.ts'
import { dbStore, writeDefinitions } from './configDb.ts'
import { openDb } from './db.ts'

const definitions = (): RawConfig => ({
  ...emptyConfig,
  cards: [
    {
      id: 'practice',
      name: '練習',
      root: '練習',
      emoji: '🎹',
      defaultTags: ['鋼琴'],
      hiddenTags: ['口琴'],
      facts: ['心情'],
      rules: {
        find: { match: 'all', blocks: [{ ops: ['any'], layers: [[{ kind: 'tag', op: 'not', tags: ['偷懶'] }]] }] },
        now: {},
        back: { span: 'day', measure: { kind: 'total', unit: '分鐘' }, want: { kind: 'atLeast', n: 20 } },
      },
    },
  ],
  tagGroups: {
    練習: {
      emoji: '🎼',
      groups: [{ name: '樂器', color: '#3b82f6', tags: [{ label: '鋼琴', emoji: '🎹' }, { label: '吉他', emoji: '' }] }],
      values: { 鋼琴: { unit: '分鐘', decimals: 0 } },
    },
    出門: { groups: [{ name: '帶著', color: '#10b981', tags: [{ label: '吉他', emoji: '🎸' }] }] },
  },
  factInputs: { 心情: { kind: 'choice', name: '心情', options: [{ value: '🙂', label: '不錯' }] } },
  tagNotes: { 鋼琴: '只算練習曲' },
})

describe('definitions in the database', () => {
  it('stores tags and units by id, so renaming one in its dictionary renames it in every card, group, value, rule and input', () => {
    const db = openDb(':memory:')
    writeDefinitions(db, definitions())
    db.prepare("UPDATE tags_dict SET name = '彈琴' WHERE name = '鋼琴'").run()
    db.prepare("UPDATE tags_dict SET name = '偷閒' WHERE name = '偷懶'").run()
    db.prepare("UPDATE tags_dict SET name = '心境' WHERE name = '心情'").run()
    db.prepare("UPDATE unit_dict SET name = 'min' WHERE name = '分鐘'").run()

    const config = dbStore(db).read()
    const card = config.cards[0]!
    expect(card).toMatchObject({ defaultTags: ['彈琴'], hiddenTags: ['口琴'], facts: ['心境'] })
    expect(card.rules.find.blocks[0]!.layers[0]![0]).toEqual({ kind: 'tag', op: 'not', tags: ['偷閒'] })
    expect(card.rules.back?.measure).toEqual({ kind: 'total', unit: 'min' })
    expect(config.tagGroups['練習']?.groups[0]?.tags.map((t) => t.label)).toEqual(['彈琴', '吉他'])
    expect(config.tagGroups['練習']?.values).toEqual({ 彈琴: { unit: 'min', decimals: 0 } })
    expect(Object.keys(config.factInputs)).toEqual(['心境'])
    expect(config.tagNotes).toEqual({ 彈琴: '只算練習曲' })
  })

  it('keeps a tag’s emoji on the tag itself, the same under every root that groups it', () => {
    const db = openDb(':memory:')
    writeDefinitions(db, definitions())
    const { tagGroups } = dbStore(db).read()
    expect(tagGroups['練習']).toMatchObject({ emoji: '🎼', groups: [{ tags: [{ label: '鋼琴', emoji: '🎹' }, { label: '吉他', emoji: '🎸' }] }] })
    expect(tagGroups['出門']?.groups[0]?.tags).toEqual([{ label: '吉他', emoji: '🎸' }])
  })

  it('refuses an edit that breaks the whole and undoes every write made in the same transaction', () => {
    const db = openDb(':memory:')
    writeDefinitions(db, definitions())
    const store = dbStore(db)
    db.prepare("INSERT INTO events (card_id, created_at) VALUES ('practice', 0)").run()
    const moveAndBreak = db.transaction(() => {
      db.prepare("UPDATE events SET card_id = 'pure'").run()
      store.update((raw) => {
        raw.cards[0]!.facts = ['無此輸入']
      })
    })
    expect(moveAndBreak).toThrow(/unknown fact/)
    expect(db.prepare('SELECT card_id FROM events').get()).toEqual({ card_id: 'practice' })
    expect(store.read().cards[0]?.facts).toEqual(['心情'])
  })
})
