# The assistant's clips

The assistant at godview.in/avatar is a person seated in a room, played from
short pre-made clips. Nothing is billed per minute: the clips are plain files,
the voice is the browser's own, and only the question itself goes to Claude.

The trick that makes it look live: **every clip starts and ends on the same
still** (same pose, mouth closed, hands resting). The app can then cut from any
clip to any other without a visible jump.

Until the clips exist the page shows the still with a slow breathing zoom, and
before that, a glowing orb.

**The look:** a minimalist luxury villa at golden hour. Warm beige textured
plaster, a tall window on the left over a calm sea and hazy mountains, an
olive tree and a pale stone sculpture. The woman wears a charcoal textured
wrap blazer, dark brown hair in a loose updo, and sits in a rounded cream
boucle armchair. She sits a little back and **in the left third** of the
frame: the panel goes on the plain plaster wall on the right, and from a
little further away loose lip sync isn't noticed.

Everything below is made in **Google Flow** (labs.google/flow).

## 1. Set up Flow

1. Open labs.google/flow and start a **New project** (name it "GodView avatar").
2. In the prompt box settings: aspect ratio **16:9 (landscape)**, outputs per
   prompt **2** (two takes to choose from), model **the newest Veo, Fast**
   (Veo 3.1 Fast at the time of writing). Fast costs far fewer credits; use
   Quality only to redo a clip whose face or mouth looks off.

## 2. The hero still (make this first)

Every clip starts and ends on this image, so take time over it.

1. Switch the prompt box to **image** creation (Flow's image model, "Nano
   Banana"). If your Flow can't attach a reference image there, do this step in
   the Gemini app instead (gemini.google.com, same image model).
2. Attach the GodView mockup image as the reference.
3. Paste:

> Use the attached image as the reference for the woman, her clothes, her hair
> and the room. Create a new, clean photograph with no interface at all: no
> logo, no text, no buttons, no chat panel, no menu icon.
>
> Photorealistic 16:9 cinematic still of a serene, minimalist luxury villa
> living room at golden hour. On the far left, a floor-to-ceiling window looks
> over a calm sea, the edge of an infinity pool and soft hazy mountains at
> sunset, with an olive tree branch and a smooth pale abstract stone sculpture
> on a plinth. The rest of the room is warm beige limestone plaster with a
> subtle organic relief; on the far right, a recessed wall niche with soft
> hidden warm lighting. Warm, gentle sunset light from the window.
>
> The same woman, in the same charcoal textured wool wrap blazer, dark brown
> hair in a loose elegant updo with a few soft strands framing her face, sits
> in a rounded cream boucle armchair. She is in the left third of the frame,
> her face about one third in from the left edge, about three metres from the
> camera, seen from mid thigh up with the whole armchair visible. Her hands
> rest together in her lap, her mouth is gently closed, her shoulders are
> relaxed, and she looks into the camera with a calm, warm, slight smile.
>
> The right half of the frame is calm and uncluttered, only the plaster wall
> and the niche light, because text will be placed there. Eye level camera,
> 50mm lens, soft depth of field, natural skin texture, no text, no logos.

4. Generate until you have one where: no interface is left, both hands are
   whole (five fingers each), her mouth is closed, she sits in the left third,
   and the right half is plain wall. Download it as **`still.png`**.

## 3. The clips (Frames to Video)

For each clip:

1. Switch the prompt box to **Frames to Video**.
2. **First frame:** upload `still.png`. **Last frame:** upload the same
   `still.png`. (If the last-frame slot is missing, switch to the newest Veo
   model.)
3. Paste the clip's prompt **followed by the ending below**, then generate.
4. Watch both takes. Keep the one whose last second settles back onto the
   still with no jump (play it on loop to check). If her face, clothes or
   hands change, or her mouth is open at the end, generate again.
5. Download at **1080p** (the upscaled option) and save it with the file name
   in the table. Don't use Extend or the scene builder; each clip stands alone.

Add this ending to every prompt:

> Static locked-off camera, no zoom, no pan, no cuts. The lighting and framing
> never change. Slow, subtle, natural movement. No music. In the final second
> she is back in exactly the starting pose: hands resting together in her lap,
> mouth closed, looking into the camera.

| File | Prompt (then the ending above) |
|---|---|
| `idle-1.mp4` | She sits calmly, breathing slowly, blinks naturally a few times, with a tiny relaxed shift of her shoulders. She does not speak. |
| `idle-2.mp4` | She sits relaxed, glances briefly toward the sunset through the window on the left, then back to the camera with a faint smile. She does not speak. |
| `listen.mp4` | She listens attentively to someone off camera: she leans forward very slightly, tilts her head a little and nods gently twice, then settles back. She does not speak. |
| `think.mp4` | She thinks for a moment: she glances up and slightly to the side with her lips closed and a small thoughtful tilt of the head, then looks back at the camera. She does not speak. |
| `talk-1.mp4` | She speaks warmly to the camera in a calm, friendly voice, with small natural head movements, and says: "Of course. Let me open that for you, it will only take a moment." Then she closes her mouth with a slight smile. |
| `talk-2.mp4` | She explains something in a friendly way, lifting one hand slightly from her lap in a small open gesture and lowering it again, and says: "Attendance looks good today. Most classes have already been marked." Then she closes her mouth. |
| `talk-3.mp4` | She speaks softly with a gentle smile and a small nod in the middle of the sentence, and says: "Fees collected this month are on track. Would you like to see the details?" Then she closes her mouth. |
| `gesture.mp4` | Within the first two seconds she smiles and opens one hand, palm up, toward the right side of the frame, as if showing someone the way. She holds it there for a moment, then slowly rests her hand back in her lap. She does not speak. |
| `greet.mp4` | She looks up at the camera as if someone has just walked in, smiles warmly and says: "Hello! How can I help you today?" with a small welcoming nod, then settles back. |

The spoken lines are there only to get natural lip movement: the app plays
the clips muted and speaks the real answer with the browser's voice.

## 4. Hand them over

Put `still.png` and the nine clips in one folder (for example
`~/Desktop/GodView-clips`). From there, the setup (Claude can do this):

- **Shrink:** about 1 to 2 MB each, sound removed, `greet` trimmed to about
  4 seconds and `gesture` to about 3:

  ```sh
  ffmpeg -i in.mp4 -an -vf "scale=1280:-2" -c:v libx264 -crf 26 -preset slow \
    -pix_fmt yuv420p -movflags +faststart out.mp4
  ```

- **Still:** taken from the first frame of `idle-1.mp4`, so it matches the
  clips exactly: `ffmpeg -i idle-1.mp4 -frames:v 1 -q:v 3 still.jpg`
- **Drop in:** the files go in `frontend/public/concierge/` with a
  `clips.json` beside them:

```json
{
  "poster": "still.jpg",
  "focus": "30% 40%",
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
answer is spoken; gesture plays briefly before the page opens what was asked
for; greet plays once when the assistant opens.
