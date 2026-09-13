import { describe, expect, test } from 'bun:test'
import {
  shouldFilterSuggestion,
  unwrapSuggestionText,
} from '../../../services/PromptSuggestion/promptSuggestion.js'

function filtered(suggestion: string): boolean {
  return shouldFilterSuggestion(suggestion, 'user_intent')
}

describe('shouldFilterSuggestion — English behavior is unchanged', () => {
  test('keeps ordinary suggestions', () => {
    expect(filtered('run the tests')).toBe(false)
    expect(filtered('commit this')).toBe(false)
    expect(filtered('/clear')).toBe(false)
  })

  test('keeps allowlisted single words', () => {
    for (const word of ['yes', 'ok', 'push', 'commit', 'no']) {
      expect(filtered(word)).toBe(false)
    }
  })

  test('drops non-allowlisted single words', () => {
    expect(filtered('maybe')).toBe(true)
    expect(filtered('done')).toBe(true)
  })

  test('drops meta, evaluative, and Claude-voice text', () => {
    expect(filtered('no suggestion')).toBe(true)
    expect(filtered('(silence — the user should assess)')).toBe(true)
    expect(filtered('thanks')).toBe(true)
    expect(filtered("Let me run the tests")).toBe(true)
  })

  test('drops over-long and multi-sentence text', () => {
    expect(filtered('a '.repeat(20).trim())).toBe(true)
    expect(filtered('Run the tests. Then commit.')).toBe(true)
    expect(filtered('x'.repeat(100))).toBe(true)
  })
})

describe('shouldFilterSuggestion — mixed-script and short CJK suggestions survive', () => {
  test('keeps spaceless Japanese and Chinese suggestions', () => {
    expect(filtered('テストを実行して')).toBe(false)
    expect(filtered('运行测试')).toBe(false)
    expect(filtered('再実行')).toBe(false)
    expect(filtered('提交代码')).toBe(false)
  })

  test('keeps Korean suggestions', () => {
    expect(filtered('테스트 실행해줘')).toBe(false)
    expect(filtered('커밋해줘')).toBe(false)
  })

  test('keeps suggestions mixing CJK with latin identifiers', () => {
    expect(filtered('src/main.tsx を修正して')).toBe(false)
    expect(filtered('运行 bun test')).toBe(false)
    expect(filtered('QueryEngine.ts 확인해줘')).toBe(false)
  })

  test('drops a single CJK character as too short', () => {
    expect(filtered('是')).toBe(true)
    expect(filtered('네')).toBe(true)
  })

  test('keeps a normal-length CJK sentence but drops an essay', () => {
    // Han counts as half a word, kana a quarter — this is ~9 words, under budget.
    expect(
      filtered('テストを実行してから変更をコミットしてリモートにプッシュして'),
    ).toBe(false)
    expect(
      filtered(
        '运行测试然后提交代码并推送到远程仓库再创建拉取请求并请求同事进行代码审查',
      ),
    ).toBe(true)
  })
})

describe('shouldFilterSuggestion — CJK meta and evaluative text is dropped', () => {
  test('drops "stay silent" spelled out in CJK', () => {
    for (const s of ['沈黙', '沉默', '침묵', '提案なし', '特にありません']) {
      expect(filtered(s)).toBe(true)
    }
    expect(filtered('没有建议')).toBe(true)
    expect(filtered('제안 없음')).toBe(true)
  })

  test('drops CJK completion markers', () => {
    for (const s of ['完了', '完了しました', '完成了', '완료']) {
      expect(filtered(s)).toBe(true)
    }
  })

  test('drops full-width and CJK bracket wrapping', () => {
    expect(filtered('（沈黙）')).toBe(true)
    expect(filtered('【提案なし】')).toBe(true)
    expect(filtered('〔silence〕')).toBe(true)
  })

  test('drops CJK thanks and approval', () => {
    for (const s of [
      'ありがとうございます',
      '助かりました',
      '谢谢你',
      '感谢',
      '감사합니다',
      '고마워요',
    ]) {
      expect(filtered(s)).toBe(true)
    }
    for (const s of ['良さそうですね', '看起来不错', '太好了', '좋네요']) {
      expect(filtered(s)).toBe(true)
    }
  })

  test('drops CJK Claude-voice openers but keeps 我们', () => {
    expect(filtered('让我运行测试')).toBe(true)
    expect(filtered('我来修复这个问题')).toBe(true)
    expect(filtered('我会检查日志')).toBe(true)
    expect(filtered('我们运行测试吧')).toBe(false)
  })

  test('drops CJK multi-sentence text', () => {
    expect(filtered('测试通过了。现在提交吧')).toBe(true)
    expect(filtered('テストは通った。コミットして')).toBe(true)
  })
})

describe('unwrapSuggestionText', () => {
  test('strips a single wrapping tag', () => {
    expect(unwrapSuggestionText('<suggestion>run the tests</suggestion>')).toBe(
      'run the tests',
    )
  })

  test('leaves nested same-tag content alone', () => {
    const nested = '<result>a</result>b<result>c</result>'
    expect(unwrapSuggestionText(nested)).toBe(nested)
  })

  test('strips English and CJK labels, including full-width colon', () => {
    expect(unwrapSuggestionText('Suggestion: run the tests')).toBe(
      'run the tests',
    )
    expect(unwrapSuggestionText('提案：テストを実行して')).toBe(
      'テストを実行して',
    )
    expect(unwrapSuggestionText('건의: 커밋해줘')).toBe('건의: 커밋해줘')
    expect(unwrapSuggestionText('제안: 커밋해줘')).toBe('커밋해줘')
    expect(unwrapSuggestionText('建议：运行测试')).toBe('运行测试')
  })

  test('leaves unlabeled text untouched', () => {
    expect(unwrapSuggestionText('  run the tests  ')).toBe('run the tests')
  })
})
