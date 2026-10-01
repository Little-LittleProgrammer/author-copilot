# Word import fixtures

`chinese.doc` and `chinese.docx` are locally generated Word documents (macOS `textutil`) containing this original text:

```text
雨夜来信

林舟推开旧书店的门。
第二段保留中文、标点和 café。
```

They exercise genuine OLE DOC and OOXML DOCX extraction, including Chinese text, an accented Latin character, and paragraph boundaries. No Office installation or conversion command is required when running the tests.

`chapters.doc` and `chapters.docx` are generated from the adjacent `chapters.txt` using the same local `textutil` conversion. They cover volume headings, chapter splitting, front matter and an extra chapter through the real desktop import flow.
