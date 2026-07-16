"""
PDF Tools - Flask Backend
支持合并、拆分、删除页面、旋转、重排、查看信息
"""
import os
import io
import zipfile
import re
from datetime import datetime
from pathlib import Path

from flask import Flask, request, send_file, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from pypdf import PdfReader, PdfWriter, PdfMerger

app = Flask(__name__, static_folder=None)

UPLOADS_DIR = Path(__file__).parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# ==================== Helpers ====================

def parse_page_range(range_str: str, total_pages: int) -> list[int]:
    """Parse page range string like '1,3,5-8' into sorted page numbers (1-indexed)."""
    result = set()
    if not range_str or not range_str.strip():
        return []

    parts = range_str.split(",")
    for part in parts:
        part = part.strip()
        if "-" in part:
            try:
                start, end = map(int, part.split("-"))
                for i in range(max(1, start), min(end, total_pages) + 1):
                    result.add(i)
            except ValueError:
                continue
        else:
            try:
                num = int(part)
                if 1 <= num <= total_pages:
                    result.add(num)
            except ValueError:
                continue

    return sorted(result)


def format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.2f} MB"


def cleanup_old_files():
    """Remove uploaded files older than 1 hour."""
    now = datetime.now().timestamp()
    for f in UPLOADS_DIR.iterdir():
        if f.is_file():
            age = now - f.stat().st_mtime
            if age > 3600:
                try:
                    f.unlink()
                except OSError:
                    pass


# ==================== Frontend ====================

@app.route("/")
def index():
    return send_file("public/index.html")


@app.route("/<path:filename>")
def static_files(filename):
    """Serve static files from public/ directory."""
    return send_from_directory("public", filename)


# ==================== API: Merge PDFs ====================

@app.route("/api/merge", methods=["POST"])
def merge_pdfs():
    try:
        files = request.files.getlist("pdfs")
        if len(files) < 2:
            return jsonify({"error": "请上传至少2个PDF文件"}), 400

        merger = PdfMerger()
        for f in files:
            if f.filename:
                merger.append(f.stream)

        output = io.BytesIO()
        merger.write(output)
        merger.close()
        output.seek(0)

        return send_file(
            output,
            mimetype="application/pdf",
            as_attachment=True,
            download_name="merged.pdf",
        )
    except Exception as e:
        return jsonify({"error": f"合并PDF失败: {str(e)}"}), 500


# ==================== API: Split PDF ====================

@app.route("/api/split", methods=["POST"])
def split_pdf():
    try:
        f = request.files.get("pdf")
        if not f:
            return jsonify({"error": "请上传一个PDF文件"}), 400

        mode = request.form.get("mode", "extract")
        reader = PdfReader(f.stream)
        total_pages = len(reader.pages)

        if mode == "extract":
            pages_str = request.form.get("pages", "")
            page_numbers = parse_page_range(pages_str, total_pages)
            if not page_numbers:
                return jsonify({"error": "无效的页码范围"}), 400

            writer = PdfWriter()
            for pn in page_numbers:
                writer.add_page(reader.pages[pn - 1])

            output = io.BytesIO()
            writer.write(output)
            output.seek(0)

            return send_file(
                output,
                mimetype="application/pdf",
                as_attachment=True,
                download_name="extracted.pdf",
            )

        elif mode == "splitAll":
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for i in range(total_pages):
                    writer = PdfWriter()
                    writer.add_page(reader.pages[i])
                    page_bytes = io.BytesIO()
                    writer.write(page_bytes)
                    page_bytes.seek(0)
                    zf.writestr(f"page_{i + 1}.pdf", page_bytes.read())

            zip_buffer.seek(0)
            return send_file(
                zip_buffer,
                mimetype="application/zip",
                as_attachment=True,
                download_name="split_pages.zip",
            )
        else:
            return jsonify({"error": "无效的拆分模式"}), 400

    except Exception as e:
        return jsonify({"error": f"拆分PDF失败: {str(e)}"}), 500


# ==================== API: Remove Pages ====================

@app.route("/api/remove-pages", methods=["POST"])
def remove_pages():
    try:
        f = request.files.get("pdf")
        if not f:
            return jsonify({"error": "请上传一个PDF文件"}), 400

        pages_str = request.form.get("pages", "")
        reader = PdfReader(f.stream)
        total_pages = len(reader.pages)

        pages_to_remove = set(parse_page_range(pages_str, total_pages))
        writer = PdfWriter()

        for i in range(total_pages):
            if (i + 1) not in pages_to_remove:
                writer.add_page(reader.pages[i])

        if len(writer.pages) == 0:
            return jsonify({"error": "删除后PDF将没有页面"}), 400

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)

        return send_file(
            output,
            mimetype="application/pdf",
            as_attachment=True,
            download_name="pages_removed.pdf",
        )
    except Exception as e:
        return jsonify({"error": f"删除页面失败: {str(e)}"}), 500


# ==================== API: PDF Info ====================

@app.route("/api/info", methods=["POST"])
def pdf_info():
    try:
        f = request.files.get("pdf")
        if not f:
            return jsonify({"error": "请上传一个PDF文件"}), 400

        # Read file bytes for size and metadata
        file_bytes = f.read()
        file_size = len(file_bytes)

        reader = PdfReader(io.BytesIO(file_bytes))
        total_pages = len(reader.pages)
        metadata = reader.metadata or {}

        pages_info = []
        for i, page in enumerate(reader.pages):
            # pypdf can access mediabox dimensions
            mb = page.mediabox
            width = round(float(mb.width))
            height = round(float(mb.height))
            pages_info.append({"page": i + 1, "width": width, "height": height})

        return jsonify({
            "fileName": secure_filename(f.filename or "unknown.pdf"),
            "pageCount": total_pages,
            "fileSize": file_size,
            "fileSizeFormatted": format_file_size(file_size),
            "pages": pages_info,
            "title": str(metadata.get("/Title", "N/A")),
            "author": str(metadata.get("/Author", "N/A")),
            "creator": str(metadata.get("/Creator", "N/A")),
            "creationDate": str(metadata.get("/CreationDate", "")),
            "modificationDate": str(metadata.get("/ModDate", "")),
        })
    except Exception as e:
        return jsonify({"error": f"读取PDF信息失败: {str(e)}"}), 500


# ==================== API: Rotate PDF ====================

@app.route("/api/rotate", methods=["POST"])
def rotate_pdf():
    try:
        f = request.files.get("pdf")
        if not f:
            return jsonify({"error": "请上传一个PDF文件"}), 400

        angle = int(request.form.get("rotation", 90))
        pages_str = request.form.get("pages", "")

        file_bytes = f.read()
        reader = PdfReader(io.BytesIO(file_bytes))
        total_pages = len(reader.pages)

        pages_to_rotate = (
            set(parse_page_range(pages_str, total_pages))
            if pages_str.strip()
            else set(range(1, total_pages + 1))
        )

        writer = PdfWriter()
        for i in range(total_pages):
            page = reader.pages[i]
            if (i + 1) in pages_to_rotate:
                page.rotate(angle)
            writer.add_page(page)

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)

        return send_file(
            output,
            mimetype="application/pdf",
            as_attachment=True,
            download_name="rotated.pdf",
        )
    except Exception as e:
        return jsonify({"error": f"旋转PDF失败: {str(e)}"}), 500


# ==================== API: Reorder PDF ====================

@app.route("/api/reorder", methods=["POST"])
def reorder_pdf():
    try:
        f = request.files.get("pdf")
        if not f:
            return jsonify({"error": "请上传一个PDF文件"}), 400

        order = request.form.get("order", "reverse")

        file_bytes = f.read()
        reader = PdfReader(io.BytesIO(file_bytes))
        total_pages = len(reader.pages)

        if order == "reverse":
            new_order = list(range(total_pages - 1, -1, -1))
        else:
            new_order = [int(x.strip()) - 1 for x in order.split(",")]
            if len(new_order) != total_pages:
                return jsonify({"error": "新顺序的页数与原PDF不符"}), 400
            if any(i < 0 or i >= total_pages for i in new_order):
                return jsonify({"error": "页面编号超出范围"}), 400

        writer = PdfWriter()
        for idx in new_order:
            writer.add_page(reader.pages[idx])

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)

        return send_file(
            output,
            mimetype="application/pdf",
            as_attachment=True,
            download_name="reordered.pdf",
        )
    except Exception as e:
        return jsonify({"error": f"重排PDF失败: {str(e)}"}), 500


# ==================== Startup ====================

if __name__ == "__main__":
    cleanup_old_files()
    print("=" * 50)
    print("  PDF Tools Server (Python + pypdf)")
    print("  http://localhost:3000")
    print("  Merge | Split | Remove | Rotate | Reorder | Info")
    print("=" * 50)
    app.run(host="0.0.0.0", port=3000, debug=True)
