#!/usr/bin/env python3
"""Build the Japanese, pre-submission PDF deck. No credentials or network needed."""
from pathlib import Path
import os

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf' / 'story-domino-submission-draft.pdf'
FONT_PATH = os.environ.get('STORY_PDF_FONT', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
if not Path(FONT_PATH).exists():
    raise SystemExit('日本語を含む TrueType フォントのパスを STORY_PDF_FONT に設定してください。')
pdfmetrics.registerFont(TTFont('Japanese', FONT_PATH))

W, H = 960, 540
BG = HexColor('#FFFDF7')
INK = HexColor('#2B2540')
MUTED = HexColor('#655F72')
PURPLE = HexColor('#6C45C3')
GREEN = HexColor('#2D725D')
RULE = HexColor('#DCD5E7')
DRAFT = '提出前ドラフト・3サービスのブラウザー実操作を確認'
M = 54

OUT.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
c.setTitle('物語のドミノ - 提出前ドラフト')
c.setAuthor('')
c.setSubject('Daytona HackSprint Tokyo 2026-09-12 / 3サービスのブラウザー実操作を確認')

def text(x, y, value, size=19, color=INK):
    c.setFillColor(color)
    c.setFont('Japanese', size)
    c.drawString(x, y, value)

def lines(x, y, values, size=19, leading=30, color=INK):
    for value in values:
        text(x, y, value, size, color)
        y -= leading
    return y

def rule(y, x=M, width=W-2*M):
    c.setStrokeColor(RULE)
    c.setLineWidth(0.7)
    c.line(x, y, x + width, y)

def base(number, title=None):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    if title:
        text(M, 459, title, 34)
    rule(48)
    text(M, 26, DRAFT, 12, PURPLE)
    text(854, 26, f'{number} / 5', 12, MUTED)

def end():
    c.showPage()

# 1. A quiet, large type cover.
base(1)
text(M, 454, 'Daytona HackSprint Tokyo  ·  2026.09.12', 16, MUTED)
text(M, 349, '物語のドミノ', 62)
text(M, 288, 'ひとつの設定から、物語の続きを見直す。', 25, PURPLE)
text(M, 219, 'デモ題材', 15, MUTED)
text(M, 183, '『消えたデモ ― 発表まであと2分』', 26)
lines(M, 110, [
    'スポンサーに関係する架空のハッカソン喜劇です。',
    '実在企業の障害や発言を描いたものではありません。',
], size=15, leading=23, color=MUTED)
end()

# 2. Native text table: original evidence and the specified change boundary.
base(2, '変更が波及する場面')
text(M, 410, '変更する前提', 15, PURPLE)
text(M, 377, '実はデモのファイルは存在し、正しく起動できる状態だった。', 23)
text(M, 328, '元の5場面', 15, MUTED)
text(789, 328, '扱い', 15, MUTED)
rows = [
    ('01', '発表直前、チームが「完成です！」と宣言する。', '維持', GREEN),
    ('02', '起動ボタンを押すが、デモが動かない。', '維持', GREEN),
    ('03', '調べると、起動するファイルが存在しない。', '修正候補', PURPLE),
    ('04', '全員が「誰かが作っている」と思っていたことが判明する。', '修正候補', PURPLE),
    ('05', '役割を分担し、最小のデモを完成させる。', '修正候補', PURPLE),
]
y = 293
for number, original, treatment, color in rows:
    text(M, y, number, 19, color)
    text(104, y, original, 19)
    text(789, y, treatment, 17, color)
    rule(y - 15)
    y -= 42
text(M, 70, '元のオチ：「足りなかったのは計算能力ではなく、担当者でした。」', 15, MUTED)
end()

# 3. Implemented sponsor roles; current evidence is listed on the final slide.
base(3, '検索・生成・形式検査の役割')
stages = [
    ('01', 'Neo4j', '関係を検索', [
        '場面・前提・依存関係を保存。',
        '変更する前提からたどり、影響する場面IDを取得。',
        '実サービスの画面は、検索結果を使って色づけ。',
    ]),
    ('02', 'Nosana', '修正案を生成', [
        '元の物語、変更する前提、影響・維持する場面を渡す。',
        '設定済みモデルは qwen3.5:9b（Ollama）。',
        '短文応答と、全5場面のJSON修正案の実生成に成功。',
    ]),
    ('03', 'Daytona', '隔離環境で検査', [
        '場面IDの欠落・重複と、5場面の存在をコードで検査。',
        '場面1・2の維持を確認し、実行結果をアプリへ返す。',
        '文章の意味や、すべての矛盾の検出は保証しない。',
    ]),
]
y = 402
for number, service, label, descriptions in stages:
    text(M, y, number, 21, PURPLE)
    text(100, y, service, 27)
    text(100, y - 30, label, 17, PURPLE)
    lines(332, y + 2, descriptions, size=17, leading=25)
    rule(y - 75)
    y -= 115
end()

# 4. Distinguish validation and judgment, and make reversibility concrete.
base(4, '修正案は、比較してから採用')
text(M, 398, 'コードで確認すること', 23, PURPLE)
lines(M, 352, [
    '必要な場面IDがすべて存在する',
    '場面IDの欠落・重複がない',
    '5つの場面がそろっている',
    '場面1・2が元の内容と一致する',
], size=19, leading=38)
text(524, 398, '本人が読んで判断すること', 23, PURPLE)
lines(524, 352, [
    '変更理由に納得できるか',
    '新しい展開が前提と合っているか',
    '笑いと物語の流れが自然か',
    '修正前後を比較して採用するか',
], size=19, leading=38)
rule(189)
text(M, 148, '採用後も「元に戻す」で、元の5場面・前提・オチに戻せます。', 22)
lines(M, 103, [
    '展開例：古いタブを開いていたと気づき、正しいタブへ切り替える。',
    'これは事前作成のサンプルです。実際のAI生成結果ではありません。',
], size=16, leading=25, color=MUTED)
end()

# 5. Live verification and remaining limitations are separate.
base(5, '現在の実装と、提出までの確認')
text(M, 399, '実際に確認できたこと', 23, PURPLE)
lines(M, 352, [
    'Neo4j：場面3・4・5の実検索',
    'Nosana：短文応答と実生成',
    'Daytona：実生成結果の7項目合格',
    'ブラウザーで採用・復元を確認',
], size=19, leading=36)
text(524, 399, '残る確認', 23, PURPLE)
lines(524, 352, [
    '説明を含む2分のリハーサル',
    '生成文の意味は人が判断',
    '発表前の接続・モデル準備',
    '公開・提出直前の本人確認',
], size=19, leading=36)
rule(183)
text(M, 153, 'ローカルテスト75件合格。初回のモデル準備は発表前に済ませます。', 17)
text(M, 120, '提出先：主催者の Google フォーム', 18)
text(M, 91, '必要物：公開 GitHub リポジトリ、10 MB 以下の PDF、本人・チーム情報', 14)
text(M, 67, '主催者投稿の締切は16:00。全3スポンサー必須かと締切の時間帯表記は要確認。', 12, MUTED)
end()

c.save()
print(str(OUT))
