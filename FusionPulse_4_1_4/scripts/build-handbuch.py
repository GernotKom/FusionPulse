#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Erzeugt das Benutzerhandbuch als PDF  ->  docs/FusionPulse_Handbuch.pdf
Aufruf:  npm run handbuch      (oder: python3 scripts/build-handbuch.py)

ZWEI GRUNDSAETZE, die den Aufwand rechtfertigen:

1. Die Versionsnummer wird aus package.json gelesen, nicht eingetippt. Sonst
   traegt das Handbuch nach dem naechsten Release eine falsche Nummer, und
   niemand merkt es, weil ein PDF nicht getestet wird.

2. Der Glossarteil wird aus dem GLOSS-Objekt in public/app.js geparst, nicht
   abgeschrieben. Ein von Hand gepflegtes Glossar driftet zwangslaeufig von der
   Anwendung weg und wird zur zweiten, stillen Wahrheit. Wer einen Begriff in
   app.js aendert, aendert ihn damit automatisch auch im Handbuch.

Neue Kacheln oder Einstellungen gehoeren in die Kapiteltexte weiter unten —
das ist Handarbeit und soll es bleiben. Aber Begriffe und Version pflegen sich
selbst.
"""
import json, re, datetime, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
HEUTE   = datetime.date.today()

def _lade_glossar():
    """Schneidet das GLOSS-Objekt aus public/app.js heraus und parst es."""
    src = (ROOT/'public'/'app.js').read_text(encoding='utf-8')
    i = src.find('const GLOSS')
    if i < 0:
        sys.exit('FEHLER: GLOSS nicht in public/app.js gefunden — Handbuch waere ohne Glossar.')
    k = src.find('{', i); tiefe = 0; ende = k
    for idx in range(k, len(src)):
        if src[idx] == '{': tiefe += 1
        elif src[idx] == '}':
            tiefe -= 1
            if tiefe == 0: ende = idx; break
    obj = src[k:ende+1]
    out = {}
    for key, val in re.findall(r"([A-Za-z_]\w*)\s*:\s*'((?:[^'\\]|\\.)*)'", obj):
        out[key] = val.replace("\\'", "'").replace('\\"', '"').replace('\\n', ' ')
    if len(out) < 20:
        sys.exit(f'FEHLER: nur {len(out)} Glossareintraege geparst — das Muster passt nicht mehr.')
    return out
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, PageBreak, Table, TableStyle,
                                KeepTogether, HRFlowable)

GLOSS = _lade_glossar()

# ── Farben: gedämpft, druckbar, keine Bildschirm-Neonfarben ────────────────
INK    = colors.HexColor('#15181d')
MUTED  = colors.HexColor('#5b636e')
ACCENT = colors.HexColor('#1d4f73')
WARN   = colors.HexColor('#8a6100')
RULE   = colors.HexColor('#c8ced6')
BOXBG  = colors.HexColor('#f2f5f8')
WARNBG = colors.HexColor('#fdf6e4')

def S(name, **kw):
    base = dict(fontName='Helvetica', fontSize=9.6, leading=14.2, textColor=INK,
                alignment=TA_LEFT, spaceAfter=5)
    base.update(kw)
    return ParagraphStyle(name, **base)

st_title   = S('t',  fontName='Helvetica-Bold', fontSize=25, leading=29, spaceAfter=5)
st_sub     = S('ts', fontSize=11.5, leading=16, textColor=MUTED, spaceAfter=16)
st_h1      = S('h1', fontName='Helvetica-Bold', fontSize=16.5, leading=20,
               textColor=ACCENT, spaceBefore=15, spaceAfter=7)
st_h2      = S('h2', fontName='Helvetica-Bold', fontSize=12, leading=15.5,
               spaceBefore=11, spaceAfter=4)
st_h3      = S('h3', fontName='Helvetica-Bold', fontSize=10.2, leading=13.5,
               textColor=colors.HexColor('#333b45'), spaceBefore=8, spaceAfter=3)
st_body    = S('b')
st_small   = S('sm', fontSize=8.6, leading=12.4, textColor=MUTED)
st_bullet  = S('bu', leftIndent=11, bulletIndent=2, spaceAfter=3)
st_gloss   = S('gl', fontSize=9.2, leading=13.2, spaceAfter=7)
st_toc1    = S('c1', fontName='Helvetica-Bold', fontSize=10.4, leading=16, spaceAfter=1)
st_toc2    = S('c2', fontSize=9.4, leading=14, leftIndent=13, textColor=MUTED, spaceAfter=0)
st_boxh    = S('bh', fontName='Helvetica-Bold', fontSize=9.8, leading=13, spaceAfter=3)

story = []
def P(t, s=st_body):  story.append(Paragraph(t, s))
def H1(t):            story.append(Paragraph(t, st_h1)); story.append(
                          HRFlowable(width='100%', thickness=0.7, color=RULE,
                                     spaceBefore=1, spaceAfter=7))
def H2(t):            story.append(Paragraph(t, st_h2))
def H3(t):            story.append(Paragraph(t, st_h3))
def SP(h=6):          story.append(Spacer(1, h))
def BUL(items):
    for it in items:
        story.append(Paragraph(it, st_bullet, bulletText='•'))
    SP(4)

def BOX(head, lines, warn=False):
    inner = [Paragraph(head, st_boxh)] + [Paragraph(l, st_body) for l in lines]
    t = Table([[inner]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WARNBG if warn else BOXBG),
        ('BOX',        (0,0), (-1,-1), 0.7, WARN if warn else RULE),
        ('LEFTPADDING',(0,0), (-1,-1), 9), ('RIGHTPADDING',(0,0),(-1,-1), 9),
        ('TOPPADDING', (0,0), (-1,-1), 7), ('BOTTOMPADDING',(0,0),(-1,-1), 7),
    ]))
    story.append(KeepTogether(t)); SP(8)

def TBL(rows, widths, head=True):
    data = [[Paragraph(c, st_small if not (head and i==0) else
                       S('th', fontName='Helvetica-Bold', fontSize=8.8, leading=12))
             for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    style = [('GRID', (0,0), (-1,-1), 0.4, RULE),
             ('VALIGN', (0,0), (-1,-1), 'TOP'),
             ('LEFTPADDING',(0,0),(-1,-1), 5), ('RIGHTPADDING',(0,0),(-1,-1), 5),
             ('TOPPADDING',(0,0),(-1,-1), 4), ('BOTTOMPADDING',(0,0),(-1,-1), 4)]
    if head:
        style += [('BACKGROUND', (0,0), (-1,0), BOXBG)]
    t.setStyle(TableStyle(style))
    story.append(t); SP(9)

def G(key, title=None):
    """Ein Glossareintrag, wortgleich aus der App."""
    txt = GLOSS.get(key)
    if not txt:
        return
    txt = txt.replace('&', '&amp;').replace('<', '&lt;')
    if ':' in txt[:60]:
        lead, rest = txt.split(':', 1)
        story.append(Paragraph(f'<b>{lead}:</b>{rest}', st_gloss))
    else:
        story.append(Paragraph(txt, st_gloss))

# ══════════════════════════════════════════════════════════════════════════
#  TITELSEITE
# ══════════════════════════════════════════════════════════════════════════
SP(38)
P('FusionPulse', st_title)
P(f'Benutzerhandbuch zu Version {VERSION} &nbsp;·&nbsp; Stand {HEUTE.strftime("%d.%m.%Y")}', st_sub)

BOX('Was diese App ist', [
    'Ein <b>Suchwerkzeug</b>. Sie soll aus rund 12.000 US-Aktien und den EUR-Paaren bei '
    'Bitpanda die wenigen Kandidaten sichtbar machen, die gerade wirtschaftlich '
    'interessant sein könnten — und zwar mit dem Rechenweg offengelegt, damit die '
    'Entscheidung nachvollziehbar bleibt.',
    'Eine fehlende Kauf-Freigabe ist <b>kein Versagen</b> der App. Eine Kandidatenliste '
    'ohne interessante Titel schon.',
])
BOX('Was diese App nicht ist', [
    'Kein Auto-Trading: Es wird nie eine Order ausgelöst. Jede Order setzt der Nutzer '
    'selbst bei seinem Broker.',
    'Keine Anlageberatung und keine Nachrichtenquelle.',
    'Kein Orakel: Alle Zahlen sind Beschreibungen der Vergangenheit und der Gegenwart. '
    'Keine einzige Kennzahl in dieser App sagt die Zukunft voraus.',
], warn=True)

P('Dieses Handbuch erklärt jede Kachel, jede Einstellung und jeden Begriff in normaler '
  'Sprache. Es setzt keine Börsenkenntnisse voraus. Wer nur schnell loslegen will, liest '
  'Kapitel 1 und 2 und schlägt den Rest bei Bedarf nach.', st_body)
SP(4)
P('Der Glossarteil (Kapitel 9) ist wortgleich aus der Anwendung übernommen. Er wurde nicht '
  'für dieses Dokument neu geschrieben, damit Handbuch und Programm nicht auseinanderdriften '
  'können. Was im Programm unter „📖 Glossar" steht, steht auch hier.', st_small)

story.append(PageBreak())

# ══════════════════════════════════════════════════════════════════════════
#  INHALTSVERZEICHNIS
# ══════════════════════════════════════════════════════════════════════════
P('Inhalt', st_h1)
story.append(HRFlowable(width='100%', thickness=0.7, color=RULE, spaceAfter=9))

toc = [
    ('1', 'In fünf Minuten startklar', [
        'Der erste Blick', 'Die drei Bereiche', 'Was zuerst einstellen']),
    ('2', 'Die Kopfzeile lesen', [
        'Marktlage und VWAP-Anteil', 'Die vier Statuslampen', 'Versionsnummern',
        'Zähler und Schalter']),
    ('3', 'Der Bereich Coins', [
        'Fokus', 'Krypto-Liste', 'Top Picks', 'Mover', 'Stimmung', 'Coin-Liste']),
    ('4', 'Der Bereich Aktien', [
        'Aktienradar', 'Die Fokuskarte', 'Premarket / Opening', 'Nachbörse',
        'Sektor-Nachzügler', 'Die Musterqualitäts-Karte']),
    ('5', 'Der Bereich Lab / Learning', [
        'Handelsjournal', 'Lernbericht', 'Muster-Labor', 'Score-Audit', 'Attribution']),
    ('6', 'Alle Einstellungen', [
        'Handelsmodus', 'Positionsgröße', 'Konto und Risiko', 'Anzeigeumfang',
        'Analyseverfahren', 'Filter und Darstellung', 'Zugang']),
    ('7', 'Woher die Daten kommen', [
        'Die vier Quellen', 'Was jede Quelle kann und was nicht',
        'Frische-Kennzeichnungen', 'Grenzen und Kontingente']),
    ('8', 'Wenn etwas nicht stimmt', [
        'Keine Aktien sichtbar', 'Plan auf altem Kurs', 'Springende Heatmap',
        'Umschalten schlägt fehl', 'Version ändert sich nicht']),
    ('9', 'Glossar', [
        'Setup-Typen', 'Bausteine der Analyse', 'Geld und Risiko',
        'Qualität und Reife', 'Daten und Betrieb']),
    ('10', 'Sicherheitsregeln der App', []),
]
for num, title, subs in toc:
    P(f'{num}. &nbsp;{title}', st_toc1)
    for s in subs:
        P(f'{s}', st_toc2)
    SP(3)

SP(10)
P('Hinweis zur Benutzung: Fast jedes Element in der Anwendung trägt einen Hilfetext, der '
  'beim Zeigen mit der Maus erscheint. Dieses Handbuch fasst diese Texte zusammen und '
  'ordnet sie ein — es ersetzt sie nicht.', st_small)

story.append(PageBreak())

# ══════════════════════════════════════════════════════════════════════════
#  1 · START
# ══════════════════════════════════════════════════════════════════════════
H1('1 · In fünf Minuten startklar')

H2('Der erste Blick')
P('Nach dem Öffnen sehen Sie drei Zonen: ganz oben die <b>Kopfzeile</b> mit dem '
  'Gesamtzustand, darunter die <b>Navigation</b> mit den drei Bereichen, und darunter die '
  'eigentlichen Inhalte. Ganz unten läuft eine schmale Leiste mit dem zuletzt '
  'interessanten Titel und dem Knopf „Plan".')

H2('Die drei Bereiche')
TBL([
    ['Bereich', 'Wofür er da ist'],
    ['<b>Coins</b>', 'Kryptowährungen, die bei Bitpanda gegen Euro handelbar sind. '
     'Läuft rund um die Uhr, sieben Tage die Woche.'],
    ['<b>Aktien</b>', 'US-Aktien. Nur werktags aktiv, mit Vorbörse, Hauptsitzung und '
     'Nachbörse. Nachts und am Wochenende passiert hier nichts Neues.'],
    ['<b>Lab / Learning</b>', 'Die Auswertung: Was hat die App in der Vergangenheit '
     'erkannt, und wie gut lag sie damit? Kein Handelsbereich, sondern die Selbstprüfung.'],
], [30*mm, 135*mm])

H2('Was Sie zuerst einstellen sollten')
P('Öffnen Sie das Zahnrad rechts oben. Drei Angaben verändern alles Weitere:')
BUL([
    '<b>Konto-Equity (€)</b> — Ihr Gesamtkapital. Daraus rechnet die App jede '
    'Positionsgröße ab.',
    '<b>Risiko pro Trade (%)</b> — wie viel Prozent der Equity Sie im schlechtesten Fall '
    'je Position verlieren wollen. Übliche Werte liegen zwischen 0,5 und 2.',
    '<b>Ordergebühr je Order (€)</b> — Ihre tatsächliche Gebühr. Ohne sie rechnet die App '
    'Gewinne aus, die es nach Kosten nicht gibt.',
])
P('Alles andere können Sie zunächst auf den Voreinstellungen lassen.')

BOX('Die wichtigste Gewöhnung', [
    'Die App zeigt <b>Ampeln</b>, keine Empfehlungen. Grün heißt: alle definierten '
    'Bedingungen sind erfüllt. Es heißt nicht, dass der Trade gut ausgeht. Gelb heißt: '
    'beobachten, aber nicht handeln. Die Entscheidung bleibt vollständig bei Ihnen.',
])

# ══════════════════════════════════════════════════════════════════════════
#  2 · KOPFZEILE
# ══════════════════════════════════════════════════════════════════════════
H1('2 · Die Kopfzeile lesen')

H2('Marktlage und VWAP-Anteil')
P('Links oben steht zum Beispiel <i>„Risk-Off · 95 % über VWAP"</i> oder <i>„Neutral · '
  '100 % über VWAP"</i>. Der erste Teil ist die grobe Marktstimmung, der zweite sagt, '
  'welcher Anteil der beobachteten Titel gerade über seinem Tagesdurchschnittskurs '
  'notiert. Ein hoher Anteil bedeutet breite Stärke, ein niedriger breite Schwäche.')
G('vwap')

H2('Die vier Statuslampen')
P('Rechts daneben stehen <b>Krypto</b>, <b>Aktien</b>, <b>Tiingo</b> und '
  '<b>Cloudflare</b>. Sie zeigen nicht den Markt, sondern die Technik:')
TBL([
    ['Farbe', 'Bedeutung'],
    ['Grün', 'Die Quelle liefert normal.'],
    ['Gelb', 'Die Quelle antwortet verzögert, unvollständig oder aus dem Zwischenspeicher. '
     'Die Anzeige ist noch brauchbar, aber nicht mehr frisch.'],
    ['Rot', 'Die Quelle liefert nicht. Was Sie sehen, ist der letzte gültige Stand.'],
], [22*mm, 143*mm])

H2('Versionsnummern — und warum es zwei sind')
P('Es stehen zwei Nummern nebeneinander, etwa <i>„v4.1.2 · Worker 4.1.2"</i>. Die erste '
  'ist die Oberfläche in Ihrem Browser, die zweite der Server. <b>Stimmen sie nicht '
  'überein, ist eine der beiden Seiten veraltet.</b> Meist hält dann der Browser eine alte '
  'Fassung fest; ein privates Fenster zeigt den tatsächlich ausgelieferten Stand.')

H2('Zähler und Schalter')
BUL([
    '<b>Nächster 5m-Takt</b> — Countdown bis zum nächsten Auswertungsschritt.',
    '<b>Drei Zahlen</b> — grüne Freigaben, gelbe Beobachtungen, insgesamt angezeigte Titel.',
    '<b>Lautsprecher</b> — Signalton an oder aus.',
    '<b>Sonne</b> — Farbschema wechseln.',
    '<b>Kreispfeil</b> — sofortige Neuauswertung erzwingen.',
    '<b>Zahnrad</b> — Einstellungen (Kapitel 6).',
])

# ══════════════════════════════════════════════════════════════════════════
#  3 · COINS
# ══════════════════════════════════════════════════════════════════════════
H1('3 · Der Bereich Coins')

H2('Fokus')
P('Die große Karte mit einem einzelnen Coin: der Titel, den die App gerade am '
  'interessantesten findet. Sie enthält den Kurs, die Ampel, den Rechenweg und — falls '
  'ein Plan zustande kommt — Einstieg, Stop und zwei Ziele. Über den Knopf '
  '<b>Bitpanda Fusion ↗</b> öffnen Sie die Handelsoberfläche.')
BOX('Zum Bitpanda-Link', [
    'Bitpanda veröffentlicht keine Direktadresse für ein einzelnes Handelspaar. Der Link '
    'führt deshalb auf die Handelsoberfläche, nicht auf den Coin selbst — das Paar müssen '
    'Sie dort im Marktverzeichnis auswählen. Ein geratener Direktlink würde vielleicht '
    'heute funktionieren und morgen ins Leere laufen; das wäre schlechter als gar keiner.',
])

H2('Krypto-Liste')
P('Alle tief analysierten Paare als Zeilen. Jede Zeile zeigt Kürzel, Ampelpunkt, '
  'Setup-Typ und die wichtigsten Kennzahlen. Das ☆ macht einen Coin zum Favoriten, das '
  'Lautsprechersymbol schaltet den Ton nur für diesen Coin ab.')

H2('Top Picks')
P('Die Auswahl mit dem besten Zusammenspiel aus Musterqualität und Handelbarkeit. '
  '<b>Wichtig:</b> „Top" bezieht sich auf die Messwerte der App, nicht auf eine Prognose.')

H2('Mover')
P('Die größten Bewegungen der letzten Stunden — unabhängig davon, ob daraus ein '
  'handelbares Muster wird. Dient der Orientierung, nicht der Auswahl.')

H2('Stimmung')
P('Marktbreite und Angst/Gier. Beantwortet die Frage: Ist gerade alles gleichzeitig in '
  'Bewegung, oder nur einzelne Titel?')
G('breadth'); G('fearGreed'); G('contrarian')

H2('Coin-Liste')
P('Das vollständige Verzeichnis der handelbaren EUR-Paare, unabhängig von der Analyse. '
  'Zum Nachschlagen, ob ein bestimmter Coin überhaupt erfasst wird.')

# ══════════════════════════════════════════════════════════════════════════
#  4 · AKTIEN
# ══════════════════════════════════════════════════════════════════════════
H1('4 · Der Bereich Aktien')

H2('Aktienradar — die Statuszeile')
P('Über der Liste steht eine Zeile wie <i>„12 aktualisiert · 40 geladen / 12.000+ '
  'Tiingo/IEX Universum · 16 angezeigt · ★ 18 · Abfrage 15:04:22"</i>.')
TBL([
    ['Angabe', 'Bedeutung'],
    ['<b>aktualisiert</b>', 'Titel, die in dieser Runde frisch berechnet wurden.'],
    ['<b>geladen</b>', 'Titel, für die überhaupt Daten vorliegen.'],
    ['<b>Universum</b>', 'Größe des durchsuchbaren Marktes.'],
    ['<b>angezeigt</b>', 'Was nach Ihrem Filter übrig bleibt.'],
    ['<b>★</b>', 'Ihre Favoriten.'],
    ['<b>Abfrage</b>', 'Uhrzeit des zugrunde liegenden Scans. <b>Steht hier 01:00:00, '
     'liegt gar kein Stand vor</b> — das ist kein Zeitpunkt, sondern das Fehlen eines.'],
], [30*mm, 135*mm])

H2('Die Fokuskarte')
P('Aufbau von oben nach unten: Kürzel und Favoritenstern, der Link zu Google Finance, '
  'der Frischeblock, Firmenname und Börse, die Handelbarkeit bei flatex, der Rechenweg, '
  'die Bewertungszeile und schließlich das Zahlenraster mit Kurs, Größe, Einstieg, Stop '
  'und Zielen.')

H3('Der Frischeblock')
P('Der wichtigste Teil, weil er sagt, wie viel die Zahlen darunter wert sind:')
BUL([
    '<b>LIVE</b> — aktueller Kurs aus der laufenden Sitzung.',
    '<b>NICHT LIVE / VERALTET</b> — der Kurs stammt aus einer früheren Sitzung. Darunter '
    'steht, aus welcher und wie alt er ist.',
    '<b>ANGEZEIGT / NICHT DIESE RUNDE</b> — der Titel ist in der Liste, wurde aber im '
    'letzten Durchlauf nicht neu gerechnet.',
])
BOX('„PLAN AUF ALTEM KURS"', [
    'Erscheint der gelbe Hinweis über dem Zahlenraster, sind Einstieg, Stop und Ziele auf '
    'einem <b>veralteten Kurs</b> gerechnet. Die Zahlen werden dann gedämpft und '
    'durchgestrichen dargestellt. Sie sind ein Rechenbeispiel, keine Ordervorlage. '
    'Vor jeder Order den echten Kurs beim Broker prüfen.',
], warn=True)

H3('Die Bewertungszeile')
P('Eine Zeile wie <i>„Discovery · Score 8,0 · Reife 100 % · Situation PULLBACK HOLD '
  '73/100 · Phase IGNITION"</i>.')
G('score'); G('maturity'); G('situationScore'); G('lifecyclePhase')
BOX('Ein ehrlicher Hinweis zur „Reife"', [
    'Die Reife ist <b>keine unabhängige zweite Meinung</b>. Sie summiert Score, '
    'Chance-Risiko-Verhältnis, Relativvolumen, Situationsscore und Lebenszyklus-Bonus — '
    'also weitgehend dieselben Größen, die schon in den Score eingehen. Ein hoher Score '
    'zieht eine hohe Reife fast zwangsläufig nach sich. Lesen Sie beide Zahlen als eine '
    'Aussage, nicht als zwei.',
])

H2('Premarket / Opening')
P('Titel mit auffälliger Bewegung vor der Eröffnung oder in den ersten neunzig Minuten. '
  'Angezeigt werden Kurslücke, Momentum-Score und Struktur. <b>Ausdrücklich kein '
  'Kaufsignal</b> — die Vorbörse ist dünn gehandelt, Kurse dort sind unzuverlässig.')

H2('Nachbörse / Extended Hours')
P('Dasselbe für die Zeit nach dem Handelsschluss. Reine Beobachtung.')

H2('Sektor-Nachzügler')
P('Sucht Titel, deren Branche bereits läuft, die selbst aber noch zurückhängen. Ein Grund '
  'hinzusehen, kein Kaufsignal — der Nachzügler kann auch aus gutem Grund zurückhängen.')

H2('Die Musterqualitäts-Karte (Heatmap)')
P('Die quadratische Karte rechts. Waagerecht die <b>Handelbarkeit</b> (Spread, Volumen, '
  'Ausführbarkeit), senkrecht die <b>Musterqualität</b>. Damit ergeben sich vier Felder:')
TBL([
    ['Feld', 'Lesart'],
    ['Rechts oben', '<b>Muster stark, gut handelbar</b> — der interessante Bereich.'],
    ['Links oben', 'Muster stark, aber schwer handelbar. Das Muster nützt wenig, wenn die '
     'Ausführung es auffrisst.'],
    ['Rechts unten', 'Gut handelbar, aber schwaches Muster. Kein Grund zum Handeln.'],
    ['Links unten', 'Beides schwach.'],
], [28*mm, 137*mm])
P('Die kurzen Linien sind <b>Spuren</b>: Sie zeigen, wohin sich ein Titel in den letzten '
  'zwei Stunden bewegt hat. Eine Spur nach rechts oben ist eine Verbesserung. Die Spuren '
  'beschreiben Bewegungsrichtung, <b>keine Ertragsaussage</b>.')

H2('Der Schalter Radar / Watchlist')
P('Rechts neben dem Filter. Zwei Betriebsarten:')
TBL([
    ['Modus', 'Verhalten'],
    ['<b>📡 Radar</b>', 'Der Server durchsucht den gesamten Markt und entdeckt selbst '
     'Kandidaten. Breite Abdeckung, dafür wird jeder Titel seltener aktualisiert.'],
    ['<b>🎯 Watchlist</b>', 'Der Server untersucht ausschließlich Ihre Favoriten, dafür '
     'jede Minute. Keine Entdeckung. <b>Sie screenen selbst.</b>'],
], [30*mm, 135*mm])
BOX('Was Sie im Watchlist-Modus übernehmen', [
    'Eine leere Trefferliste bedeutet dann <b>nicht</b> „keine Gelegenheit am Markt", '
    'sondern nur „keine in Ihrer Auswahl". Was nicht in der Liste steht, wird auch nicht '
    'gefunden. Der Modus braucht mindestens einen Favoriten — sonst wäre er ein Scanner '
    'ohne Titel.',
], warn=True)

# ══════════════════════════════════════════════════════════════════════════
#  5 · LAB
# ══════════════════════════════════════════════════════════════════════════
H1('5 · Der Bereich Lab / Learning')

P('Dieser Bereich handelt nicht, er prüft. Er beantwortet die Frage, ob die Erkennung der '
  'App in der Vergangenheit getaugt hat.')

H2('Handelsjournal')
P('Ihre eigenen Ein- und Ausstiege, soweit erfasst. Grundlage für jede ehrliche '
  'Auswertung: ohne aufgeschriebene Trades ist jede Erfolgsbilanz Erinnerung.')

H2('Lernbericht')
P('Wie oft ein erkanntes Muster anschließend das erste Ziel erreicht hat, wie oft den Stop. '
  'Angegeben mit Fallzahl — eine Trefferquote aus sieben Fällen ist keine Quote.')

H2('Muster-Labor')
P('Vergleich der Setup-Typen untereinander. Zeigt, welche Muster bei Ihnen tragen und '
  'welche nicht. Setups, die nichts bringen, können in den Einstellungen stummgeschaltet '
  'werden.')

H2('Score-Audit')
P('Zerlegt einen Score in seine Bestandteile. Hier sehen Sie, welcher Baustein eine '
  'Bewertung getragen hat — und ob sie an einer einzigen Größe hängt.')

H2('Attribution')
P('Ordnet Ergebnisse den auslösenden Bausteinen zu. Die schärfste Selbstkritik der App: '
  'Sie zeigt auch, wenn ein Baustein nichts beiträgt.')

# ══════════════════════════════════════════════════════════════════════════
#  6 · EINSTELLUNGEN
# ══════════════════════════════════════════════════════════════════════════
H1('6 · Alle Einstellungen')
P('Erreichbar über das Zahnrad rechts oben. Änderungen wirken nach „Übernehmen".')

H2('Handelsmodus')
TBL([
    ['Einstellung', 'Erklärung'],
    ['<b>Aus</b>', 'Bisheriges Verhalten, keine zusätzlichen Tagesregeln.'],
    ['<b>Modus A · Momentum-Tageshandel</b>', 'Strengere Regeln für kurzfristigen Handel '
     'innerhalb eines Tages: engere Zeitfenster, andere Anforderungen an Volumen und '
     'Ausführbarkeit.'],
], [45*mm, 120*mm])
G('tradeModeA')

H2('Positionsgröße')
TBL([
    ['Einstellung', 'Erklärung'],
    ['<b>Risikobasiert</b>', 'Sie geben vor, wie viel Sie verlieren wollen; die App rechnet '
     'daraus die Stückzahl. Die empfohlene Einstellung, weil der Verlust die Vorgabe ist '
     'und nicht das Ergebnis.'],
    ['<b>Fester Einsatz</b>', 'Sie geben die Kaufsumme vor; der mögliche Verlust ergibt '
     'sich aus dem Stop-Abstand. Einfacher, aber der Verlust schwankt von Trade zu Trade.'],
    ['<b>Einsatz je Trade (€)</b>', 'Nur bei festem Einsatz: die Kaufsumme.'],
    ['<b>Maximaler Verlust am Stop (€)</b>', 'Harte Obergrenze in Euro. 0 schaltet sie ab.'],
], [45*mm, 120*mm])
G('sizeModeRisk'); G('sizeModeFixed'); G('notional'); G('stopDistance')

H2('Konto und Risiko')
TBL([
    ['Einstellung', 'Erklärung'],
    ['<b>Konto-Equity (€)</b>', 'Gesamtkapital. Bezugsgröße für alle Prozentangaben.'],
    ['<b>Risiko pro Trade (%)</b>', 'Anteil der Equity, den Sie je Position riskieren.'],
    ['<b>Max. Kaufsumme pro Trade (€)</b>', 'Deckelt die Position unabhängig vom Risiko — '
     'gegen sehr enge Stops, die rechnerisch riesige Positionen erlauben würden.'],
    ['<b>Mindest-Netto-CRV Krypto / Aktien</b>', 'Wie viel Ertrag je Einheit Risiko '
     'mindestens erwartbar sein muss, <b>nach</b> Gebühren und Spread. Getrennt '
     'einstellbar, weil Krypto und Aktien verschiedene Kostenstrukturen haben.'],
    ['<b>Minimaler Netto-Gewinn (€)</b>', 'Unter diesem Betrag lohnt der Trade den Aufwand '
     'nicht.'],
    ['<b>Minimaler Kursweg bis TP2 (%)</b>', 'Verhindert Pläne, deren Ziel so nah liegt, '
     'dass es im Rauschen verschwindet.'],
    ['<b>Steuersatz (%)</b>', 'Für die Gewinnschätzung nach Steuern. Österreich: KESt 27,5.'],
    ['<b>Gesamt-Risikobudget (%)</b>', 'Summe des Risikos über alle offenen Positionen.'],
    ['<b>Ordergebühr je Order (€)</b>', 'Ihre tatsächliche Gebühr, beidseitig gerechnet.'],
    ['<b>Spread-/Slippage-Reserve (%)</b>', 'Puffer je Seite für die Differenz zwischen '
     'erwartetem und tatsächlichem Ausführungskurs.'],
    ['<b>Budget-Sperre</b>', 'Kein neues Grün, wenn das Gesamtrisiko ausgeschöpft ist.'],
], [45*mm, 120*mm])
G('crv'); G('rewardRisk'); G('maxLoss'); G('spread'); G('slippage'); G('planEff')

H2('Anzeigeumfang')
TBL([
    ['Einstellung', 'Erklärung'],
    ['<b>Coins scannen (4–20)</b>', 'Wie viele Paare tief analysiert werden. Mehr bedeutet '
     'breitere Suche und langsamere Runden.'],
    ['<b>Aktien tief scannen (15–40)</b>', 'Dasselbe für Aktien. Diese Zahl kostet '
     'unmittelbar Datenvolumen.'],
    ['<b>Coins / Aktien anzeigen</b>', 'Reine Anzeigegrenze. Ändert nichts an der Analyse.'],
    ['<b>Crowd/Search: Anzahl beobachteter Aktien</b>', 'Wie viele Titel zusätzlich auf '
     'Aufmerksamkeit hin beobachtet werden.'],
], [45*mm, 120*mm])

H2('Analyseverfahren')
P('Hier schalten Sie einzelne Bausteine ab. Alle sind standardmäßig aktiv. Das Abschalten '
  'ist gedacht für die Frage: <i>Trägt dieser Baustein bei mir überhaupt etwas bei?</i>')
BUL([f'<b>{n}</b>' for n in [
    'VWAP (kurz/lang)', 'EMA21 / Trendstaffelung', 'Relative Stärke vs. BTC',
    'Momentum / Multi-Timeframe', 'Volumen (z-Score)', 'Orderbuch / Imbalance',
    'Breakout / Squeeze', 'Pullback', 'Elliott-Wellen']])
P('Zusätzlich der <b>Claude Modus</b>: rechnet mit Erwartungswerten statt mit festen '
  'Schwellen. Und der <b>Analysemodus</b>, der ganze Gruppen von Verfahren kombiniert '
  '(Kombiniert / nur Elliott / Momentum+Volumen / Trend+VWAP).')
G('vwap'); G('ema21'); G('rs'); G('mtf'); G('volume'); G('book'); G('elliott')

H2('Filter und Darstellung')
TBL([
    ['Einstellung', 'Erklärung'],
    ['<b>Watchlist (immer mitscannen)</b>', 'Titel, die unabhängig von der Auswahl immer '
     'analysiert werden.'],
    ['<b>Mindest-Qualität in der Liste</b>', 'Blendet schwache Kandidaten aus.'],
    ['<b>Nur Coins mit Preis in der Zone</b>', 'Zeigt nur Titel nahe am geplanten Einstieg.'],
    ['<b>Sektor-Nachzügler hervorheben</b>', 'Kurze optische Betonung bei neuen Funden.'],
    ['<b>Farbschema</b>', 'Dunkel, hell gedämpft oder warm gedämpft.'],
    ['<b>Ton auch für Aktiensignale</b>', 'Standardmäßig klingeln nur Krypto-Signale.'],
], [45*mm, 120*mm])

H2('Zugang')
P('<b>Zugriffs-Token</b> — nur nötig, wenn beim Betrieb ein Passwort gesetzt wurde. Es ist '
  'genau der Wert, der serverseitig hinterlegt ist, und wird je Gerät einmal eingegeben.')
P('Daneben finden Sie <b>Export</b> (Einstellungen und Journal sichern) und '
  '<b>Zurücksetzen</b>.')

# ══════════════════════════════════════════════════════════════════════════
#  7 · DATEN
# ══════════════════════════════════════════════════════════════════════════
H1('7 · Woher die Daten kommen')

H2('Die vier Quellen')
TBL([
    ['Quelle', 'Liefert', 'Grenzen'],
    ['<b>Bitpanda Fusion</b>', 'Kurse, Orderbuch und Handelbarkeit der EUR-Krypto-Paare. '
     'Die maßgebliche Quelle für den Coin-Bereich, weil Sie dort auch handeln.',
     'Nur die dort gelisteten Paare.'],
    ['<b>Tiingo (IEX)</b>', 'Die Hauptquelle für US-Aktien: marktweiter Radar über rund '
     '12.000 Titel sowie Fünf-Minuten-Verläufe der ausgewählten Kandidaten.',
     'IEX ist ein <b>Teilmarkt</b> — nicht jeder Handel läuft dort. Volumen und Kurse '
     'können vom Gesamtmarkt abweichen. Dazu ein monatliches Datenvolumen-Kontingent.'],
    ['<b>Alpaca (IEX)</b>', 'Momentaufnahmen für Vorbörse und Eröffnung.',
     'Ebenfalls Teilmarkt; außerhalb der Hauptsitzung sehr dünn.'],
    ['<b>Twelve Data</b>', 'Ersatzquelle, wenn Tiingo ausfällt.',
     'Enges Kontingent, wird nur im Notfall gezogen.'],
], [28*mm, 72*mm, 65*mm])

H2('Was die Frische-Angaben bedeuten')
G('dataFreshness'); G('quoteAge'); G('tradingHours')
TBL([
    ['Marke', 'Alter', 'Konsequenz'],
    ['<b>LIVE</b>', 'aktuell', 'Zahlen belastbar.'],
    ['<b>GECACHED</b>', 'älter als 20 Minuten', 'Für die Einordnung brauchbar, für eine '
     'Order zu alt.'],
    ['<b>STALE</b>', 'älter als 24 Stunden', 'Nur noch historischer Kontext.'],
    ['<b>DATEN n. v.</b>', 'kein Zeitstempel', 'Wird vorsichtshalber wie veraltet behandelt.'],
], [30*mm, 40*mm, 95*mm])

H2('Grenzen und Kontingente')
P('Die App läuft auf einer Infrastruktur mit Tages- und Monatsgrenzen. Werden sie '
  'erreicht, verschwindet nichts stillschweigend — die Statuslampen springen auf Gelb oder '
  'Rot, und die Statuszeile nennt den Grund. Drei Grenzen sind im Alltag spürbar:')
BUL([
    '<b>Datenvolumen bei Tiingo</b> — der marktweite Radar ist mit Abstand der größte '
    'Verbraucher. Der Watchlist-Modus überspringt ihn vollständig.',
    '<b>Tägliche Schreibvorgänge in der Datenbank</b> — betrifft das Lerngedächtnis. Ist '
    'die Grenze erreicht, werden bis Mitternacht (UTC) keine neuen Auswertungen mehr '
    'gespeichert; die Anzeige läuft mit dem letzten Stand weiter.',
    '<b>US-Handelszeiten</b> — außerhalb davon wird bewusst nicht gescannt. Kein Fehler, '
    'sondern Absicht: es gibt nichts zu entdecken, und der Verzicht spart Kontingent.',
])

# ══════════════════════════════════════════════════════════════════════════
#  8 · STÖRUNGEN
# ══════════════════════════════════════════════════════════════════════════
H1('8 · Wenn etwas nicht stimmt')

H2('Keine Aktien sichtbar, Abfrage steht auf 01:00:00')
P('Es liegt gar kein Scan vor. Außerhalb der US-Handelszeiten ist das normal. Während der '
  'Sitzung deutet es auf eine erschöpfte Datenquelle hin — Statuslampen und Statuszeile '
  'prüfen.')

H2('„PLAN AUF ALTEM KURS"')
P('Kein Fehler, sondern eine Warnung: Der Plan rechnet auf einem veralteten Kurs. Wie alt, '
  'steht daneben. Vor einer Order den echten Kurs beim Broker prüfen.')

H2('Die Heatmap springt zwischen zwei Ansichten')
P('Behoben in 4.1.1. Ursache war, dass ein erzwungener Abruf auf einem Server ohne '
  'Zwischenspeicher landen konnte und dann eine kleinere Auswahl zurückgab. Tritt es '
  'erneut auf: Versionsnummern in der Kopfzeile vergleichen.')

H2('Der Modus lässt sich nicht umschalten')
P('Der Watchlist-Modus wird serverseitig gespeichert und braucht dafür genau einen '
  'Schreibvorgang. Ist das Tageslimit der Datenbank erreicht, schlägt das fehl. Seit 4.1.2 '
  'nennt die App den Grund ausdrücklich, statt einen Fehlschlag als Umschaltung zu melden. '
  'Abhilfe: bis nach Mitternacht (UTC) warten.')

H2('Die Version ändert sich nach einer Aktualisierung nicht')
P('Vergleichen Sie die beiden Nummern in der Kopfzeile. Sind beide alt, wurde nichts '
  'ausgeliefert. Ist nur die linke alt, hält Ihr Browser die alte Oberfläche fest — ein '
  'privates Fenster zeigt den tatsächlichen Stand.')

# ══════════════════════════════════════════════════════════════════════════
#  9 · GLOSSAR
# ══════════════════════════════════════════════════════════════════════════
story.append(PageBreak())
H1('9 · Glossar')
P('Wortgleich aus der Anwendung übernommen. Jeder Eintrag sagt zuerst, <i>was</i> der '
  'Begriff bedeutet, dann <i>wozu</i> er in dieser App dient.', st_small)
SP(6)

groups = [
    ('Setup-Typen — welches Muster erkannt wurde',
     ['pullback','breakout','squeeze','reclaim','elliott','relative','consolidation']),
    ('Bausteine der Analyse',
     ['vwap','ema21','rs','mtf','volume','book','atr','rvol']),
    ('Geld, Größe und Risiko',
     ['crv','rewardRisk','planEff','rMultiple','expectancy','notional','sizeModeRisk',
      'sizeModeFixed','stopDistance','maxLoss','slippage','spread','tradeModeA']),
    ('Qualität, Reife und Lebenszyklus',
     ['score','maturity','situationScore','lifecyclePhase']),
    ('Markt, Daten und Betrieb',
     ['fearGreed','contrarian','breadth','dataFreshness','quoteAge','tradingHours',
      'tickerSym','serpQuota']),
]
used = set()
for head, keys in groups:
    H2(head)
    for k in keys:
        G(k); used.add(k)

rest = [k for k in GLOSS if k not in used]
if rest:
    H2('Weitere Begriffe')
    for k in rest:
        G(k)

# ══════════════════════════════════════════════════════════════════════════
#  10 · SICHERHEIT
# ══════════════════════════════════════════════════════════════════════════
story.append(PageBreak())
H1('10 · Sicherheitsregeln der App')
P('Diese Regeln sind im Programm verankert und lassen sich nicht abschalten. Sie zu kennen '
  'hilft beim Einordnen dessen, was Sie sehen.')
BUL([
    '<b>Keine Order wird ausgelöst.</b> Die App rechnet und zeigt an. Handeln tun Sie.',
    '<b>Eine Kauf-Freigabe gibt es nur während der Eröffnung und der Hauptsitzung.</b> '
    'In Vor- und Nachbörse bleibt es bei Beobachtung, unabhängig davon, wie gut ein Muster '
    'aussieht.',
    '<b>Fehlende Information verbessert nie eine Bewertung.</b> Wo ein Wert fehlt, wird der '
    'ungünstigere Fall angenommen. Ein unbekanntes Alter gilt als veraltet, kein '
    'Zeitstempel als kein Nachweis.',
    '<b>Kosten werden vor der Freigabe abgezogen</b>, nicht danach. Gebühren, Spread und '
    'Slippage gehen in das Chance-Risiko-Verhältnis ein, bevor eine Ampel grün wird.',
    '<b>Veraltete Zahlen werden gekennzeichnet, nicht versteckt.</b> Lieber ein sichtbar '
    'alter Stand als eine leere Fläche — aber niemals ein alter Stand, der wie ein frischer '
    'aussieht.',
])

SP(10)
story.append(HRFlowable(width='100%', thickness=0.7, color=RULE, spaceAfter=8))
P(f'FusionPulse {VERSION} · Benutzerhandbuch · erstellt am {HEUTE.strftime("%d.%m.%Y")}. '
  f'Der Glossarteil ist aus dem Programmstand {VERSION} erzeugt und gilt für diese Version. '
  f'{len(GLOSS)} Begriffe.', st_small)

# ══════════════════════════════════════════════════════════════════════════
#  Dokument mit Kopf-/Fußzeile
# ══════════════════════════════════════════════════════════════════════════
def deco(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont('Helvetica', 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(22*mm, A4[1]-13*mm, f'FusionPulse {VERSION} · Benutzerhandbuch')
        canvas.drawRightString(A4[0]-22*mm, A4[1]-13*mm, f'Stand {HEUTE.strftime("%d.%m.%Y")}')
        canvas.setStrokeColor(RULE); canvas.setLineWidth(0.4)
        canvas.line(22*mm, A4[1]-15.5*mm, A4[0]-22*mm, A4[1]-15.5*mm)
        canvas.drawCentredString(A4[0]/2, 12*mm, str(doc.page))
    canvas.restoreState()

(ROOT/'docs').mkdir(exist_ok=True)
doc = BaseDocTemplate(str(ROOT/'docs'/'FusionPulse_Handbuch.pdf'),
                      pagesize=A4,
                      leftMargin=22*mm, rightMargin=22*mm,
                      topMargin=20*mm, bottomMargin=18*mm,
                      title=f'FusionPulse {VERSION} — Benutzerhandbuch',
                      author='FusionPulse', subject='Bedienungsanleitung und Glossar')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='n')
doc.addPageTemplates([PageTemplate(id='all', frames=[frame], onPage=deco)])
doc.build(story)
print(f'✓ Handbuch erzeugt: docs/FusionPulse_Handbuch.pdf · Version {VERSION} · {len(GLOSS)} Glossarbegriffe')
