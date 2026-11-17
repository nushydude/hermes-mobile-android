"""Render a static planning wireframe; no app/runtime dependencies or private data."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
IMAGE = Image.new("RGB", (1760, 1090), "#f0f1ed")
DRAW = ImageDraw.Draw(IMAGE)
FONT_ROOT = Path("C:/Windows/Fonts")


def font(size, bold=False):
    return ImageFont.truetype(str(FONT_ROOT / ("segoeuib.ttf" if bold else "segoeui.ttf")), size)


def label(x, y, text, size=20, color="#23382f", bold=False):
    DRAW.text((x, y), text, font=font(size, bold), fill=color)


def box(x, y, w, h, fill="#ffffff", outline="#b3bdb5", radius=14):
    DRAW.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=fill, outline=outline, width=2)


def button(x, y, w, text, fill="#e2eee5"):
    box(x, y, w, 49, fill)
    bounds = DRAW.textbbox((0, 0), text, font=font(18, True))
    label(x + (w - bounds[2]) / 2, y + 11, text, 18, bold=True)


label(36, 20, "ONE CONVERSATION  /  proposed interaction wireframe", 32, bold=True)
label(36, 67, "Planning draft v1 - synthetic content - static illustration, not the app or final UI assets", 20)


def phone(x, title, mode="Fast", speak="Off"):
    box(x, 126, 402, 800, "#fafbf8", "#6d7d72", 24)
    label(x + 22, 146, title, 23, bold=True)
    label(x + 22, 183, "Weekend plans", 18)
    button(x + 22, 220, 118, mode)
    label(x + 162, 234, f"Speak replies: {speak}", 17)
    DRAW.line((x + 18, 288, x + 384, 288), fill="#c4ccc5", width=2)
    label(x + 22, 889, "Same Hermes session on phone + desktop", 16)


positions = (30, 462, 894, 1326)
for x, title, speak in zip(positions,
                         ("1  Text conversation", "2  Voice input", "3  Speech output", "4  Work and recovery"),
                         ("Off", "On", "On", "Off")):
    phone(x, title, speak=speak)

x = positions[0]
box(x + 80, 320, 298, 88, "#e2eee5")
label(x + 96, 339, "What could we do on Sunday?", 18)
box(x + 22, 437, 356, 169)
for i, line in enumerate(("We could plan a coastal walk.", "Would you prefer something", "close to home?")):
    label(x + 38, 456 + i * 30, line, 19)
label(x + 22, 639, "Text streams here during a reply.", 17)
box(x + 22, 735, 356, 71)
label(x + 36, 751, "Keep this draft while using voice...", 17)
button(x + 22, 823, 167, "Microphone")
button(x + 211, 823, 167, "Send")

x = positions[1]
label(x + 22, 323, "Voice in this conversation", 23, bold=True)
label(x + 22, 370, "Listening", 31, bold=True)
label(x + 22, 422, "Microphone active - foreground only", 17)
for i, height in enumerate((20, 40, 70, 44, 30, 60, 38)):
    box(x + 75 + i * 35, 550 - height, 18, height, "#b7d5be", radius=7)
label(x + 22, 583, "Real level meter (illustrated here)", 17)
label(x + 22, 632, "Words appear after STT finishes.", 18)
label(x + 22, 667, "Partial words only with live STT.", 17)
button(x + 22, 735, 356, "Finish speaking")
button(x + 22, 801, 167, "Pause voice")
button(x + 211, 801, 167, "Type instead")
label(x + 22, 860, "Typed draft is retained.", 16)

x = positions[2]
label(x + 22, 323, "Hermes is speaking", 27, bold=True)
box(x + 22, 382, 356, 161)
for i, line in enumerate(("A coastal walk sounds good.", "I can help you choose a route", "when you are ready.")):
    label(x + 38, 404 + i * 32, line, 19)
DRAW.line((x + 30, 593, x + 370, 593), fill="#bdc7bd", width=6)
DRAW.line((x + 30, 593, x + 154, 593), fill="#527d5e", width=6)
label(x + 22, 622, "Playback progress, not fake word timing", 16)
button(x + 22, 688, 167, "Pause speech")
button(x + 211, 688, 167, "Stop speaking")
button(x + 22, 754, 356, "Type instead")
label(x + 22, 829, "Stopping sound keeps the task running.", 16)
label(x + 22, 855, "Stop reply is a separate chat action.", 16)

x = positions[3]
box(x + 22, 320, 356, 92, "#f3ead6")
label(x + 38, 336, "Reconnecting - voice paused", 20, bold=True)
label(x + 38, 373, "Saved draft and accepted work remain.", 16)
label(x + 22, 442, "Tasks in this conversation", 22, bold=True)
box(x + 22, 493, 356, 124)
label(x + 38, 509, "Review changes", 20, bold=True)
label(x + 38, 545, "Running on Hermes", 18)
label(x + 38, 578, "Open details / Stop this task", 16)
box(x + 22, 641, 356, 100)
label(x + 38, 657, "Research summary", 20, bold=True)
label(x + 38, 696, "Complete - Open result in chat", 18)
label(x + 22, 775, "Show progress only when reported.", 17)
label(x + 22, 812, "Unknown outcome stays explicit.", 17)

label(36, 963, "Independent controls", 22, bold=True)
label(36, 1002, "Fast / Balanced / Deep chooses Hermes policy. Microphone chooses input. Speak replies chooses output.", 22)
label(36, 1042, "End voice releases audio. Stop reply interrupts one foreground turn. Stop this task targets one owned child.", 20)

IMAGE.save(ROOT / "wireframe.png")
