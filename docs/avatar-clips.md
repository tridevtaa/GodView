# The assistant's clips

The assistant at godview.in/avatar is a person seated in a room, played from
short pre-made clips. Nothing is billed per minute: the clips are plain files,
the voice is the browser's own, and only the question itself goes to Claude.

The trick that makes it look live: **every clip starts and ends on the same
still** (same pose, mouth closed, hands resting). The app can then cut from any
clip to any other without a visible jump.

Until the clips exist the page shows the still with a slow breathing zoom, and
before that, a glowing orb.

## 1. The hero still (make this first)

Use any image tool (Midjourney, Flux, Ideogram, ChatGPT images). 16:9, at
least 1920×1080. The person sits **back and to the left**; the right 45% of the
frame stays calm and open, because the glass panel sits there.

> Cinematic wide shot of an elegant private study in a modern Indian home,
> warm evening light from table lamps, dark walnut bookshelves, a large window
> with soft city lights out of focus. In the left third of the frame, seated in
> a cream armchair about four metres from the camera, a poised Indian woman in
> her early thirties, wearing a tailored navy blazer over an ivory top, hair
> neatly tied back, hands resting together in her lap, mouth gently closed,
> looking toward the camera with a calm, warm expression. The right half of the
> frame is uncluttered: soft shelves and lamp glow, slightly darker. Eye-level
> camera, 35mm lens, shallow depth of field, photorealistic, natural skin
> texture, no text.

Pick the version where her face is clear but small, and her hands are fully in
frame (hands are what video tools break most often).

## 2. The clips (image to video)

Use a tool that lets you set **both the first and the last frame**: Kling
(start and end frame), Runway (first and last keyframe) or Hailuo. Put the hero
still in **both** slots for every clip. 5 seconds each, 16:9, 720p or 1080p.

Add this to every prompt:

> Locked-off static camera, no zoom, no pan, no cuts. Same lighting and
> framing throughout. Subtle, natural, slow movement. She returns to exactly
> the starting pose by the end: hands resting in her lap, mouth closed,
> looking at the camera.

And as the negative prompt, where the tool has one:

> camera movement, zoom, cut, extra people, text, changing clothes, changing
> lighting, distorted hands, extra fingers, morphing face

| File | Prompt (plus the lines above) |
|---|---|
| `idle-1.mp4` | She sits still and relaxed, breathing slowly, blinks twice, a tiny shift of the shoulders. |
| `idle-2.mp4` | She sits relaxed, glances briefly to the side of the room and back to the camera, blinks, a faint smile. |
| `listen.mp4` | She leans in very slightly as if listening closely to someone, nods gently once, attentive expression, then settles back. |
| `think.mp4` | She glances up and to the side as if recalling something, a small thoughtful tilt of the head, then looks back at the camera. |
| `talk-1.mp4` | She speaks calmly and warmly to the camera, natural mouth movement as in conversation, small head movements, then closes her mouth. |
| `talk-2.mp4` | She talks to the camera in a friendly way, lifts one hand slightly from her lap in a small explaining gesture, lowers it again, mouth moving naturally, then closes her mouth. |
| `talk-3.mp4` | She speaks softly with a gentle smile, a slight nod in the middle of a sentence, natural mouth movement, then closes her mouth. |
| `gesture.mp4` | She smiles and opens her right hand toward the right side of the frame, as if showing someone the way, holds it a moment, then rests her hand back in her lap. |
| `greet.mp4` | She looks up at the camera as if someone just walked in, smiles warmly and says a short hello with a small nod, then settles. |

That is nine clips. Expect a few tries per clip; keep the ones whose last
frame really matches the first. Check by putting the clip on loop: if it
jumps at the loop point, try again.

**Optional, nicer greeting:** for `greet.mp4`, a lip-sync tool such as Hedra
can make her say exactly "Hello, how can I help?". The app also says the
greeting aloud with the browser's voice, so a short generic hello is enough.

## 3. Shrink them

Each clip should end up around 1 to 2 MB, with no sound (the app is muted and
speaks through the browser). With ffmpeg:

```sh
for f in *.mp4; do
  ffmpeg -i "$f" -an -vf "scale=1280:-2" -c:v libx264 -crf 26 -preset slow \
    -pix_fmt yuv420p -movflags +faststart "small/$f"
done
```

And the still, taken from the first frame of a clip so it matches exactly:

```sh
ffmpeg -i small/idle-1.mp4 -frames:v 1 -q:v 3 small/still.jpg
```

## 4. Drop them in

Put the files in `frontend/public/concierge/` with a `clips.json` next to them:

```json
{
  "poster": "still.jpg",
  "focus": "30% 55%",
  "clips": {
    "idle": ["idle-1.mp4", "idle-2.mp4"],
    "listen": ["listen.mp4"],
    "think": ["think.mp4"],
    "talk": ["talk-1.mp4", "talk-2.mp4", "talk-3.mp4"],
    "gesture": ["gesture.mp4"],
    "greet": ["greet.mp4"]
  }
}
```

- `focus` is where her face sits in the frame (CSS `object-position`). It
  keeps her in view when the room is cropped, mostly on phones.
- Any list can be left empty or out; the page falls back to idle. With only
  `poster` set, the page shows the breathing still.
- States with several clips pick a different one each time round, so talking
  doesn't visibly repeat.

How they play: idle loops while nothing happens; listen while the mic is open
or something is being typed; think while Claude answers; talk loops while the
answer is spoken; gesture plays once before the page opens what was asked
for; greet plays once when the assistant opens.
