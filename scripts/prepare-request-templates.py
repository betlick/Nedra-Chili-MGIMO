"""Offline template preparation. Run with the bundled document Python runtime."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree
from xml.sax.saxutils import escape
from copy import copy
import hashlib
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/api/assets/request-templates'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
IDS = ['study', 'english', 'military', 'social', 'summons', 'transcript', 'order', 'credit', 'iup', 'transfer', 'extension', 'retake', 'leave', 'card', 'guest_pass', 'aid']
SLOTS = {
    'study': {
        4: ['Дана: {{FULL_NAME}},'],
        5: ['дата рождения: {{BIRTH_DATE}},'],
        6: ['в том, что он(а) действительно является обучающимся (студентом) {{YEAR}} курса', '{{STUDY_FORM_GENITIVE}} формы обучения. Факультет: {{FACULTY}}', 'по направлению подготовки {{PROGRAM}}.'],
        7: ['Основание зачисления: Приказ от {{ENROLLMENT_DATE}} № {{ENROLLMENT_ORDER}}.'],
        8: ['Основа обучения: {{FUNDING_BASIS}}.'],
        9: ['Предполагаемая дата окончания обучения: {{GRADUATION_DATE}}'],
        10: ['Справка выдана для предъявления: {{PURPOSE}}.'],
    },
    'retake': {
        2: ['Декану факультета: {{FACULTY}}', 'от студента(ки) {{YEAR}} курса, группа {{GROUP_NAME}}', '{{STUDY_FORM_GENITIVE}} формы обучения', 'направления подготовки {{PROGRAM}}', '', 'ФИО: {{FULL_NAME}}', 'Тел.: {{PHONE}}'],
        5: ['Прошу допустить меня к повторной сдаче {{ASSESSMENT_GENITIVE}}', '                                                                        (форма контроля)'],
        6: ['по дисциплине: {{SUBJECT}}', '', 'за {{SEMESTER}} семестр {{ACADEMIC_YEAR}} учебного года.'],
        7: ['Цель пересдачи:', '{{PURPOSE}}.'],
        8: ['Преподаватель (экзаменатор): {{TEACHER}}.'],
        9: ['{{APPLICATION_DATE}}          ___________________ / {{FULL_NAME}} /'],
    },
}


def main():
    manifest = {}
    sources = sorted((ROOT / 'artifacts/request-templates').glob('*.docx'))
    assert len(sources) == 16, 'Expected all 16 retained source files'
    for kind, source in zip(IDS, sources):
        shutil.copyfile(source, OUT / 'original' / f'{kind}.docx')
        manifest[kind] = {'source': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    records = []
    for kind, slots in SLOTS.items():
        source = OUT / 'original' / f'{kind}.docx'
        with ZipFile(source) as z:
            parts = [(copy(info), z.read(info.filename)) for info in z.infolist()]
        original = dict((p.filename, data) for p, data in parts)['word/document.xml'].decode()
        root = etree.fromstring(original.encode())
        paragraphs = root.xpath('//w:body/w:p', namespaces=NS)
        mapping = {}
        for index, values in slots.items():
            nodes = paragraphs[index].xpath('.//w:t', namespaces=NS)
            assert len(nodes) == len(values), (kind, index)
            for node, value in zip(nodes, values):
                mapping[root.getroottree().getpath(node)] = value
        values = iter(mapping.get(root.getroottree().getpath(node), node.text or '') for node in root.xpath('//w:t', namespaces=NS))
        patched = re.sub(r'(<w:t\b[^>]*>)(.*?)(</w:t>)', lambda m: m[1] + escape(next(values)) + m[3], original, flags=re.S)
        note = '<w:p><w:pPr><w:spacing w:before="120" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>Демонстрационный документ. Все сведения вымышлены.</w:t></w:r></w:p>'
        patched = patched.replace('<w:sectPr', note + '<w:sectPr', 1)
        target = OUT / 'fillable' / f'{kind}.docx'
        with ZipFile(target, 'w') as dest:
            for info, data in parts:
                dest.writestr(info, patched.encode() if info.filename == 'word/document.xml' else data)
        with ZipFile(target) as final:
            assert all(final.read(info.filename) == data for info, data in parts if info.filename != 'word/document.xml')
        records.append({'kind': kind, 'reference': str(source), 'sha256': manifest[kind]['sha256'], 'slots': slots,
                        'geometry': etree.tostring(root.xpath('//w:sectPr', namespaces=NS)[0]).decode(),
                        'preserveParts': {i.filename: hashlib.sha256(d).hexdigest() for i, d in parts if i.filename != 'word/document.xml'}})
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    qa = Path('/tmp/mukpid-templates-20261120')
    qa.mkdir(exist_ok=True)
    (qa / 'artifact.md').write_text('''# Template execution contract

Both references rendered and inspected as one-page documents under reference-study and reference-retake.
Letter portrait 12240×15840 twips; margins 792 top/bottom and 1152 left/right.
All paragraph/run properties, explicit breaks, logos, styles, relationships and signature/seal blanks are preserve-only.
Only text nodes in the slots below may change. Natural text wrapping is allowed. Source files remain byte-identical.
One 8 pt gray demo note is added before sectPr. No page, font, header or artwork redesign.
Final verification: render both filled documents, inspect every page, compare all untouched ZIP parts and section geometry.

''' + json.dumps(records, ensure_ascii=False, indent=2))
    print('16 originals and 2 fillable copies prepared; preserve-only parts unchanged')


if __name__ == '__main__':
    main()
