from __future__ import annotations

import html
import math
import os
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "diagrams"


def ensure_out_dir() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    if os.name == "nt":
        base = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        candidates.extend(
            [
                base / ("arialbd.ttf" if bold else "arial.ttf"),
                base / ("calibrib.ttf" if bold else "calibri.ttf"),
            ]
        )
    candidates.extend(
        [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(str(candidate), size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt) -> tuple[int, int]:
    bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=4, align="center")
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int) -> str:
    lines: list[str] = []
    for paragraph in str(text).split("\n"):
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            trial = f"{current} {word}"
            if draw.textbbox((0, 0), trial, font=fnt)[2] <= max_width:
                current = trial
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return "\n".join(lines)


def rounded_box(draw: ImageDraw.ImageDraw, box, fill, outline, radius=18, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def arrow(draw: ImageDraw.ImageDraw, start, end, fill="#1f2937", width=4, head=14):
    x1, y1 = start
    x2, y2 = end
    draw.line((x1, y1, x2, y2), fill=fill, width=width)
    angle = math.atan2(y2 - y1, x2 - x1)
    left = (x2 - head * math.cos(angle - math.pi / 6), y2 - head * math.sin(angle - math.pi / 6))
    right = (x2 - head * math.cos(angle + math.pi / 6), y2 - head * math.sin(angle + math.pi / 6))
    draw.polygon([end, left, right], fill=fill)


def center_text(draw: ImageDraw.ImageDraw, box, text: str, fnt, fill="#111827", spacing=4):
    x1, y1, x2, y2 = box
    tw, th = text_size(draw, text, fnt)
    x = x1 + (x2 - x1 - tw) / 2
    y = y1 + (y2 - y1 - th) / 2
    draw.multiline_text((x, y), text, font=fnt, fill=fill, spacing=spacing, align="center")


def label_pill(draw: ImageDraw.ImageDraw, xy, text, fnt, fill="#ecfeff", outline="#06b6d4", text_fill="#0f172a"):
    x, y, w, h = xy
    rounded_box(draw, (x, y, x + w, y + h), fill, outline, radius=999, width=2)
    center_text(draw, (x + 6, y + 4, x + w - 6, y + h - 4), text, fnt, fill=text_fill, spacing=2)


def generate_architecture_png(path: Path) -> None:
    W, H = 2400, 1500
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    title_font = font(56, bold=True)
    subtitle_font = font(24, bold=False)
    section_font = font(28, bold=True)
    box_font = font(25, bold=True)
    small_font = font(18, bold=False)
    tiny_font = font(16, bold=False)

    draw.text((W / 2, 42), "VisionFlow Architecture", font=title_font, fill="#111827", anchor="ma")
    draw.text((W / 2, 112), "Default local runtime wired by root `npm start`", font=subtitle_font, fill="#4b5563", anchor="ma")

    # Top context bar
    rounded_box(draw, (90, 160, W - 90, 232), fill="#f8fafc", outline="#cbd5e1", radius=22, width=2)
    draw.text((120, 190), "Request path", font=section_font, fill="#0f172a")
    draw.text((330, 194), "Web App -> API Gateway -> Backend Services -> MongoDB / GridFS / Storage", font=small_font, fill="#334155")

    # Client and gateway
    web = (120, 320, 560, 500)
    gw = (690, 310, 1090, 520)
    auth = (1230, 250, 1780, 415)
    route = (1230, 430, 1780, 570)

    rounded_box(draw, web, fill="#fff7ed", outline="#f59e0b")
    rounded_box(draw, gw, fill="#ecfeff", outline="#06b6d4")
    rounded_box(draw, auth, fill="#eef2ff", outline="#6366f1")
    rounded_box(draw, route, fill="#eef2ff", outline="#6366f1")

    center_text(draw, web, "Web App\nReact + Vite", box_font)
    center_text(draw, gw, "API Gateway\nLocal Flask Proxy", box_font)
    center_text(draw, auth, "Auth Service\n/api/signup\n/api/login", box_font)
    center_text(draw, route, "Gateway routes\nRoutes requests to the right service", box_font)

    # Main services row
    services = [
        ((120, 620, 510, 810), "Project Service\nNode / Express\nProjects, assets, batches,\ndeployments, metrics", "#dcfce7", "#22c55e"),
        ((570, 620, 960, 810), "Dataset Service\nFlask\nVersions, dataset export,\nanalytics, annotation status", "#dbeafe", "#3b82f6"),
        ((1020, 620, 1410, 810), "Training Service\nFlask + PyTorch\nJobs, model registry,\ntraining artifacts", "#fef3c7", "#f59e0b"),
        ((1470, 620, 1860, 810), "Inference Service\nFlask\nAuto-label, infer,\ninference history", "#fce7f3", "#ec4899"),
    ]
    for box, text, fill, outline in services:
        rounded_box(draw, box, fill=fill, outline=outline)
        center_text(draw, box, text, box_font, spacing=6)

    # Data layer
    mongo = (230, 1030, 660, 1210)
    storage = (790, 1030, 1260, 1210)
    workers = (1400, 1010, 2110, 1230)
    rounded_box(draw, mongo, fill="#f8fafc", outline="#94a3b8")
    rounded_box(draw, storage, fill="#f8fafc", outline="#94a3b8")
    rounded_box(draw, workers, fill="#f8fafc", outline="#94a3b8")

    center_text(draw, mongo, "MongoDB\nUsers, projects, assets,\nannotations, models, jobs", box_font)
    center_text(draw, storage, "Storage + GridFS\nuploads / datasets / training artifacts", box_font)
    center_text(draw, workers, "Background workers\nExport manager and job workers\n(kept lightweight in local runtime)", box_font)

    # Route mapping note
    note = (1900, 250, 2310, 810)
    rounded_box(draw, note, fill="#f8fafc", outline="#cbd5e1")
    draw.text((1938, 282), "Gateway routing map", font=section_font, fill="#0f172a")
    mapping = [
        "Auth: /api/signup, /api/login",
        "Project: /api/projects, /api/assets, /api/batches, /api/workflows",
        "Dataset: /api/projects/*/versions, /api/versions/*, /api/projects/*/dataset",
        "Training: /api/projects/*/train, /api/projects/*/jobs, /api/models/*",
        "Inference: /api/projects/*/models/*/infer, /api/auto-label, /api/classify",
    ]
    yy = 340
    for line in mapping:
        wrapped = wrap_text(draw, line, tiny_font, 330)
        draw.text((1938, yy), wrapped, font=tiny_font, fill="#334155")
        yy += 82

    # Arrows from client to gateway and services to data.
    arrow(draw, (560, 410), (690, 410), fill="#374151", width=5)
    arrow(draw, (1090, 410), (1230, 330), fill="#374151", width=5)
    arrow(draw, (1090, 410), (1230, 500), fill="#374151", width=5)

    # Gateway to services
    for target_x in [315, 765, 1215, 1665]:
        arrow(draw, (890, 520), (target_x, 620), fill="#475569", width=4)

    # Services to data store
    service_centers = [315, 765, 1215, 1665]
    for cx in service_centers:
        arrow(draw, (cx, 810), (450 if cx < 600 else 1025 if cx < 1000 else 990 if cx < 1400 else 1025, 1030), fill="#64748b", width=4)

    arrow(draw, (1200, 810), (1030, 1030), fill="#64748b", width=4)
    arrow(draw, (1650, 810), (1030, 1030), fill="#64748b", width=4)
    arrow(draw, (1090, 520), (1530, 620), fill="#475569", width=4)

    # Specific data links.
    label_pill(draw, (185, 890, 330, 46), "project + asset writes", small_font)
    label_pill(draw, (730, 890, 330, 46), "versions + exports", small_font)
    label_pill(draw, (1180, 890, 330, 46), "training jobs + models", small_font)
    label_pill(draw, (1625, 890, 330, 46), "inference history", small_font)

    # Bottom callout
    rounded_box(draw, (90, 1280, W - 90, 1425), fill="#111827", outline="#111827", radius=26, width=1)
    draw.text((120, 1320), "Main platform journey", font=section_font, fill="#ffffff")
    journey = (
        "Create or sign in -> create project -> upload images -> annotate/review -> generate version -> train model -> "
        "run inference or export results"
    )
    draw.text((480, 1324), wrap_text(draw, journey, small_font, 1730), font=small_font, fill="#e5e7eb")

    img.save(path)


def generate_callflow_png(path: Path) -> None:
    W, H = 2400, 1500
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    title_font = font(56, bold=True)
    subtitle_font = font(24, bold=False)
    step_font = font(26, bold=True)
    body_font = font(20, bold=False)
    small_font = font(18, bold=False)
    label_font = font(17, bold=True)

    draw.text((W / 2, 44), "VisionFlow Call Flow", font=title_font, fill="#111827", anchor="ma")
    draw.text((W / 2, 112), "Compact end-to-end journey from UI action to service response", font=subtitle_font, fill="#4b5563", anchor="ma")

    # Rows
    rows = [
        ("1. Sign in", "Web App -> API Gateway -> Auth Service", "/api/signup, /api/login", "#fff7ed", "#f59e0b"),
        ("2. Create project / upload", "Web App -> API Gateway -> Project Service", "/api/projects, /api/assets, /api/batches", "#ecfeff", "#06b6d4"),
        ("3. Annotate + version", "Web App -> API Gateway -> Dataset Service", "/api/assets/:id/annotations, /api/projects/:id/versions", "#dbeafe", "#3b82f6"),
        ("4. Train + infer", "Web App -> API Gateway -> Training / Inference", "/api/projects/:id/train, /api/projects/:id/models/:modelId/infer", "#fef3c7", "#f59e0b"),
    ]

    left = 120
    box_w = 2160
    box_h = 250
    gap = 36
    top = 220

    for idx, (heading, flow, endpoints, fill, outline) in enumerate(rows):
        y1 = top + idx * (box_h + gap)
        y2 = y1 + box_h
        rounded_box(draw, (left, y1, left + box_w, y2), fill=fill, outline=outline, radius=24, width=3)
        # left accent strip
        draw.rounded_rectangle((left, y1, left + 18, y2), radius=24, fill=outline, outline=outline)
        draw.text((170, y1 + 34), heading, font=step_font, fill="#0f172a")
        draw.text((170, y1 + 86), flow, font=body_font, fill="#1f2937")
        pill_y = y1 + 144
        label_pill(draw, (170, pill_y, 520, 44), endpoints, label_font, fill="#ffffff", outline="#cbd5e1", text_fill="#111827")
        draw.text((760, y1 + 156), "Data layer:", font=label_font, fill="#475569")
        data_text = "MongoDB + GridFS + Storage" if idx < 3 else "MongoDB + training artifacts + inference history"
        draw.text((900, y1 + 156), data_text, font=label_font, fill="#334155")

    # Connector arrows between rows on the right side
    for idx in range(3):
        y = top + idx * (box_h + gap) + box_h
        arrow(draw, (W - 180, y - 8), (W - 180, y + gap + 8), fill="#64748b", width=4)

    # Bottom summary
    rounded_box(draw, (120, 1320, 2280, 1420), fill="#111827", outline="#111827", radius=24, width=1)
    draw.text((160, 1356), "Result:", font=step_font, fill="#ffffff")
    summary = "The gateway stays thin and routes each request to one domain service, while MongoDB and storage keep the shared state and artifacts."
    draw.text((320, 1358), wrap_text(draw, summary, small_font, 1840), font=small_font, fill="#e5e7eb")

    img.save(path)


def mx_cell(cell_id: str, value: str = "", style: str = "", parent: str = "1", vertex: bool = False, edge: bool = False,
            source: str | None = None, target: str | None = None, x: int = 0, y: int = 0, w: int = 0, h: int = 0) -> ET.Element:
    attrs = {"id": cell_id, "value": value, "style": style, "parent": parent}
    if vertex:
        attrs["vertex"] = "1"
    if edge:
        attrs["edge"] = "1"
    if source is not None:
        attrs["source"] = source
    if target is not None:
        attrs["target"] = target
    cell = ET.Element("mxCell", attrs)
    if vertex or edge:
        geom = ET.SubElement(cell, "mxGeometry", {"x": str(x), "y": str(y), "width": str(w), "height": str(h), "as": "geometry"})
        if edge:
            geom.set("relative", "1")
    return cell


def make_drawio_callflow(path: Path) -> None:
    mxfile = ET.Element("mxfile", {
        "host": "app.diagrams.net",
        "modified": "2026-06-25T00:00:00.000Z",
        "agent": "VisionFlow diagram generator",
        "version": "24.7.17",
        "type": "device",
    })
    diagram = ET.SubElement(mxfile, "diagram", {"name": "VisionFlow Call Flow"})
    model = ET.SubElement(diagram, "mxGraphModel", {
        "dx": "1800",
        "dy": "1200",
        "grid": "1",
        "gridSize": "10",
        "guides": "1",
        "tooltips": "1",
        "connect": "1",
        "arrows": "1",
        "fold": "1",
        "page": "1",
        "pageScale": "1",
        "pageWidth": "2400",
        "pageHeight": "1500",
        "math": "0",
        "shadow": "0",
    })
    root = ET.SubElement(model, "root")
    root.append(ET.Element("mxCell", {"id": "0"}))
    root.append(ET.Element("mxCell", {"id": "1", "parent": "0"}))

    title_style = "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontStyle=1;fontSize=24;strokeColor=none;fillColor=none;"
    root.append(mx_cell("2", "VisionFlow Call Flow", title_style, x=810, y=20, w=780, h=40, vertex=True))
    root.append(mx_cell("3", "Compact journey from UI action to service response", "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;strokeColor=none;fillColor=none;fontSize=13;color=#4b5563;",
                        x=720, y=58, w=960, h=30, vertex=True))

    steps = [
        ("4", "1. Sign in", "Web App -> API Gateway -> Auth Service", "/api/signup, /api/login", 100),
        ("5", "2. Create project / upload", "Web App -> API Gateway -> Project Service", "/api/projects, /api/assets, /api/batches", 450),
        ("6", "3. Annotate + version", "Web App -> API Gateway -> Dataset Service", "/api/assets/:id/annotations, /api/projects/:id/versions", 800),
        ("7", "4. Train + infer", "Web App -> API Gateway -> Training / Inference", "/api/projects/:id/train, /api/projects/:id/models/:modelId/infer", 1150),
    ]
    step_ids = []
    for cell_id, title, flow, endpoints, x in steps:
        style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#94a3b8;fontSize=16;spacing=10;shadow=0;"
        value = (
            f"<b>{html.escape(title)}</b><br/>"
            f"<span style='font-size:13px;color:#1f2937'>{html.escape(flow)}</span><br/>"
            f"<span style='font-size:12px;color:#334155'>{html.escape(endpoints)}</span>"
        )
        root.append(mx_cell(cell_id, value, style, x=x, y=170, w=520, h=140, vertex=True))
        step_ids.append(cell_id)

    data = [
        ("8", "MongoDB + GridFS + Storage", 240, 420),
        ("9", "MongoDB + training artifacts", 900, 420),
        ("10", "MongoDB + inference history", 1560, 420),
    ]
    for cell_id, title, x, y in data:
        style = "shape=mxgraph.flowchart.database;whiteSpace=wrap;html=1;fillColor=#f8fafc;strokeColor=#94a3b8;fontSize=14;"
        root.append(mx_cell(cell_id, html.escape(title), style, x=x, y=y, w=240, h=120, vertex=True))

    # arrows between steps
    arrow_style = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeColor=#64748b;"
    edges = [
        ("11", "4", "5", 620, 210, 360, 40),
        ("12", "5", "6", 1050, 210, 360, 40),
        ("13", "6", "7", 1480, 210, 360, 40),
        ("14", "4", "8", 250, 330, 10, 60),
        ("15", "5", "8", 660, 330, 10, 60),
        ("16", "6", "9", 1120, 330, 10, 60),
        ("17", "7", "10", 1650, 330, 10, 60),
    ]
    for edge_id, src, tgt, x, y, w, h in edges:
        root.append(mx_cell(edge_id, "", arrow_style, edge=True, source=src, target=tgt, x=x, y=y, w=w, h=h))

    # footer
    footer_style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#111827;strokeColor=#111827;fontSize=14;fontColor=#ffffff;spacing=8;"
    footer_value = html.escape("The gateway stays thin. Each step resolves to one service, with shared state in MongoDB and files in storage.")
    root.append(mx_cell("18", footer_value, footer_style, x=170, y=620, w=2060, h=80, vertex=True))

    ET.indent(mxfile, space="  ")
    path.write_text(ET.tostring(mxfile, encoding="unicode"), encoding="utf-8")


def main() -> None:
    ensure_out_dir()
    generate_architecture_png(OUT_DIR / "visionflow-architecture.png")
    generate_callflow_png(OUT_DIR / "visionflow-callflow.png")
    make_drawio_callflow(OUT_DIR / "visionflow-callflow.drawio")
    print(f"Generated diagrams in {OUT_DIR}")


if __name__ == "__main__":
    main()
