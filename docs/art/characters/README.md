# Alternative character concepts

![Motu Uncle and the ten alternative characters, idle and eat](storyboard.png)

Motu Uncle (a chubby version of the current Uncle) and ten alternative characters to choose from. **Concept art only:** nothing here is
wired into the app. Open [`storyboard.html`](storyboard.html) for the full sheet (it is self-contained,
with inline SVG and no external resources): name, origin, signature detail, how each one eats, chews
and spits a file, and both poses side by side.

| File | What |
|---|---|
| `NN-slug.svg` | Idle pose, layered SVG (the master drawing) |
| `NN-slug-eat.svg` | Eat pose: the same layers with the jaw/mouth, eyes, brows and arms changed |
| `NN-slug-idle.png`, `NN-slug-eat.png` | 512×512 renders (sharp) |
| `storyboard.png`, `storyboard.html` | Overview sheet |
| `_build/` | Generator: `node docs/art/characters/_build/render.mjs [slug…]` rewrites every file above |

They are built the same way as the Uncle (`src/renderer/common/uncle/UncleSvg.tsx`). Ink lines are
filled outline shapes: an ink copy of each form, offset down-right, sits under the colour copy, so the
line is thin top-left and heavy bottom-right. Colours are flat and warm, with one cel-shadow tone per
material, a lit ellipse clipped to the head, and editorial hatching on some shadow sides. Every
character has a huge mouth (the jaw drops 54–62 units, against the Uncle's 30) and one signature detail
that still reads at about 250 px.

## The characters

**00 · Motu Uncle** (the key piece). This is our current in-app Uncle with the same parts and colours
copied from `UncleSvg.tsx`: wild grey side tufts, a comb-over, round glasses, the bushy moustache, the
gold tooth, and the mole with its one curly hair. He wears the same argyle vest, shirt and red bow
tie. What changes is that he is much fatter: a wide, jowly head with a double chin, puffed cheeks, a
huge round belly with a straining button (it hangs by a thread in the eat pose), short chubby arms,
and thick sausage fingers. The layer names match the existing rig one-to-one, so he is the cheapest
option to ship. Swap the `headPath` proportions, the torso and the hands, and keep `pose.ts` as it is.


**01 · Chacha Gappu** (India). The neighbourhood chacha: thick, oiled, side-parted hair with grey
temples, a short bushy moustache and a paan-red grin. He wears a cream kurta under a teal Nehru vest
whose buttons strain over his round belly, with little gaps of kurta showing between them. Signature:
the folded paan in his fist, plus the paan-stained grin. He pats his belly, says "Arre wah!" and slurps
the file down. While he chews, the belly jiggles (in the eat pose, motion marks sit beside the belly),
and at 100 % a vest button pings off.

**02 · Dadi Amma** (India). A silver bun with a jasmine gajra, big maroon cat-eye glasses on a beaded
gold chain, a magenta saree with a gold-bordered pallu, gold bangles and stud earrings. Her smile is
soft, and when the mouth opens it is wide and gap-toothed. Signature: the steel pressure cooker. It
whistles once per 25 % while she chews, and its final "phweeet!" means the conversion is done. In idle
she holds the cooker handle and cups her cheek with the other hand.

**03 · Halwai Bhaiya** (India). A chubby sweet-shop owner in a white ribbed baniyan with bare
shoulders. He has a red-checked towel on his shoulder, tight curls, stubble, a double chin and a sweat
drop from the kadhai. Signature: a giant, glistening jalebi held up like a trophy. The progress ring
could be drawn as a jalebi coiling itself.

**04 · Auto-wala Uncle** (Mumbai). A khaki uniform shirt with flap pockets and a pen, a tweed flat cap
worn at an angle, sideburns, a gold tooth, and a magnificent curled handlebar moustache. Signature: the
black-and-yellow mechanical fare meter. In idle the flag is up and the meter reads 00.00. In eat the
flag is down and the fare ticks (18.50), so the meter is the progress bar. Note: a first pass with a
peaked uniform cap and a brass badge read as a police officer, so both were removed.

**05 · Great-Uncle Nickels** (the "Grunkle-style" con man). Inspired by the *genre* of the lovable
scheming great-uncle, and deliberately original: no fez, no eyepatch, no glasses, no black suit, no
stubble. He wears a loud orange-and-teal plaid jacket, a purple polka-dot tie and a carnation, and has
a long face with a big cleft chin, a pencil moustache, one eyebrow shot up, a lopsided smirk and a gold
tooth that glints. Signatures: the coin (one per file; he bites it to check it is real) and the
hand-painted MYSTERY DEALS sign. Running gag: his crooked toupee lifts clean off his head when he
gulps.

**06 · Sumo-san** (Japan). A gentle, polite giant, drawn respectfully: an oiled black topknot,
closed-eye contented smile, rosy cheeks, a broad bare chest and a navy mawashi with hanging cords. The
design uses no ring rituals or religious elements. Signature: the shiko stomp. While he chews he
stomps left and right, the topknot boings and dust puffs fly (both are shown in the eat pose). Lines:
"Itadakimasu!" before he eats, "Gochisōsama deshita" when he hands the result over.

**07 · Nonna Pina** (Italy). A cloud of tight white curls, happy squinting eyes with crow's feet,
pearls and a lace collar, a black dress and a red gingham apron with a floury handprint. Signature: the
rolling pin, and flour dusted on her rosy cheeks. She rolls the file flat like pasta dough and slurps
it like tagliatelle. The progress ring could fill like rising dough.

**08 · Captain Chomp** (the Seven Seas). The only 3/4 figure in the set, so that the peg leg shows: one
boot and one wooden peg under striped trousers. He has a tricorn with a small skull-and-bones, an
eyepatch, a bushy ginger beard that stretches with the jaw, a gold hoop and a navy coat with a red sash.
Signature: Polly the parrot on his shoulder squawks the format name (the eat pose shows a "PNG!"
bubble).

**09 · Pehlwan Pappu** (India). A village akhada wrestler-uncle with a buzz cut, a curled moustache
and a big round belly in a blue-striped vest over red langot-style shorts. Akhada mitti (dust) sits on
his shoulders and arm. Signature: a tall glass of milk with a foamy top. In idle he flexes one arm and
raises the glass with the other. While he chews he grunts every 10 %, and dust puffs off his shoulders.

**10 · Abuela Rosa** (Mexico). A chubby abuela with a grey bun, a big red flower and gold drop
earrings. She wears an embroidered blouse under a striped rebozo shawl. Signature: her clay olla,
steaming, and the wooden spoon she points with. While she chews, the steam curls into the progress
ring, and the result comes out ladled from the olla.

## Mapping onto the existing animation rig

Every SVG uses the Uncle's layer vocabulary. Each group has `data-part="<rig name>"` and a document-unique
`id="<slug>-<pose>-<rig name>"`:

```
root
├─ body                         (bodyY bob; clothing, belly, props attached to the body)
├─ arm L/R  → arm L/R ink+sleeve paths (armPath: shoulder → wrist, rubber hose)
├─ head                         (headX/headY/headRot/squash, pivot near the neck)
│  ├─ earL/earR, hair / bun / topknot / toupee / cap / hat   (parallax "behind" layers)
│  ├─ skull                     (headInk/headFill/headClip: one jaw-aware path per character)
│  └─ face                      (turnRig foreshortening)
│     ├─ cheeks (blush, smile creases)   ├─ chin
│     ├─ mouth > mouthFill, throat, uvula, tongue, lowerTeeth, upperTeeth, mouthLine, lip
│     ├─ moustache / beard / nose / signature face detail (paan stain, flour, eyepatch …)
│     ├─ eyes > eyeL/eyeR > pupilL/pupilR, lidL/lidR (+ lowerL/lowerR smile lids)
│     └─ brows > browL/browR
└─ handL/handR                  (open palm or fist; same HAND/THUMB shapes as the Uncle)
```

What porting one would take:

- **Jaw.** Each skull comes from `headD({... jaw})` in `_build/lib.mjs`, which generalises
  `paths.ts → headPath` (chin drop = `jaw × drop`, jowl easing). The eat mouth (`mouthOpen`) is
  `mouthPath` with a wider `w` and a deeper `bottom`. A port turns both into procedural functions of
  `pose.jaw` and `pose.smile`, then tweens between the two poses drawn here (idle `mouthClosed`, eat
  `mouthOpen`). The beard (Captain Chomp) and stubble (Halwai) are already parameterised by the jaw.
- **Eyes.** These are the same parts the Uncle uses: clipped pupils, which `pupilOffset` can drive
  directly, and an upper lid (`lidPath`). The new lower "smile" lid (`lowerL/lowerR`) maps to
  `pose.happy`. In idle, Sumo-san and Nonna draw closed happy arcs, which is the Uncle's `happyL/happyR` state.
- **Head turn / parallax.** `DEPTH` applies as-is to `ears`, `hair`, `brows`, `eyes`, `nose`,
  `moustache` and `mouth`. Hats, buns, topknots and the toupee are separate groups, so they can take
  the hair depth plus their own spring (secondary motion, like the Uncle's comb-over).
- **Signature props are separate groups with obvious state hooks:** `cooker` (whistle and steam per
  25 %), `meter` (flag rotation + digits = progress), `sign`/`coin`, `parrot` (beak +
  bubble text = target format), `rollingPin`, `jalebi`, `stompDust`/`topknot` (chew beat), `toupee`
  (lifts at `jaw > 0.8`), `milk`, `olla`/`spoon`, `strainButton` (Motu Uncle, pops at 100 %).
- **Canvas.** The viewBox is `-220 -206 440 440`, with the face origin at (0, 0) as in the Uncle, so
  `HEAD_CENTER` and the options ring carry over. Captain Chomp's 3/4 figure is wrapped in a 0.92 scale
  group, and his head sits higher (face centre ≈ (0, −50)).
