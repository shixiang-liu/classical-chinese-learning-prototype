from io import BytesIO
from pathlib import Path

from docx import Document
from pypdf import PdfReader

_TEXT_SUFFIXES = {'.txt', '.md', '.mdx', '.csv'}
_SUPPORTED_SUFFIXES = _TEXT_SUFFIXES | {'.pdf', '.docx'}


def list_supported_extensions() -> list[str]:
    return sorted(_SUPPORTED_SUFFIXES)


def _decode_bytes(raw: bytes) -> str:
    for encoding in ('utf-8-sig', 'utf-8', 'gb18030', 'gbk'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def extract_text_from_file(filename: str, raw: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in _SUPPORTED_SUFFIXES:
        raise ValueError(f'unsupported file type: {suffix or "unknown"}')

    if suffix in _TEXT_SUFFIXES:
        return _decode_bytes(raw).strip()

    if suffix == '.pdf':
        reader = PdfReader(BytesIO(raw))
        pages = [page.extract_text() or '' for page in reader.pages]
        return '\n\n'.join(part.strip() for part in pages if part.strip()).strip()

    if suffix == '.docx':
        document = Document(BytesIO(raw))
        parts = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
        return '\n\n'.join(parts).strip()

    raise ValueError(f'unsupported file type: {suffix or "unknown"}')
