// The Uncle: layered inline SVG drawn in an editorial-cartoon style.
// Ink lines are "filled outline shapes": every form is drawn twice — an ink copy (thick stroke, nudged
// down-right) under the colour copy — which gives a brush-like line that is thin top-left and heavy
// bottom-right. Animated parts receive their attributes from poseAttrs(); this file is static markup.
import { forwardRef, type ReactNode, type Ref } from 'react'
import type { Attrs, PartKey } from './attrs'

export const VIEWBOX = { x: -175, y: -200, w: 350, h: 450 } as const
/** Head centre in viewBox units (the point the options ring is centred on). */
export const HEAD_CENTER = { x: 0, y: -10 } as const

export const C = {
  ink: '#2b1a14',
  skin: '#f6c39b',
  skinShade: '#e49e76',
  skinLight: '#fde0c6',
  skinDeep: '#d1825f',
  nose: '#f3a57f',
  noseShade: '#de8160',
  blush: '#ef7765',
  hair: '#a49ca8',
  hairLight: '#d4cdd6',
  hairDark: '#6f6774',
  frame: '#3b261f',
  lens: '#cdeaf3',
  sclera: '#fffdf6',
  throat: '#5a1119',
  throatDeep: '#2a050b',
  tongue: '#f0707e',
  tongueShade: '#c94557',
  teeth: '#fffaf0',
  gold: '#f4c34d',
  vest: '#e8a93c',
  vestShade: '#c98a24',
  vestLight: '#f4c66a',
  shirt: '#dfeaf6',
  shirtShade: '#b9cde2',
  bow: '#d9443a',
  sweat: '#8fd3f4'
} as const

const INK_OFF = 'translate(1.4 1.9)'

type RefFn = (key: PartKey) => (el: SVGElement | null) => void

interface InkedProps {
  d: string
  fill: string
  w?: number
  /** Ink offset transform (default down-right). */
  off?: string
}

/** A static shape with a variable-weight ink outline. */
function Inked({ d, fill, w = 8, off = INK_OFF }: InkedProps): ReactNode {
  return (
    <>
      <path d={d} fill={C.ink} stroke={C.ink} strokeWidth={w} strokeLinejoin="round" transform={off} />
      <path d={d} fill={fill} />
    </>
  )
}

/** Mirror an SVG path horizontally (x → -x) for simple absolute-coordinate paths. */
export function mirrorPath(d: string): string {
  return d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${-Number(x)},${y}`)
}

// ——— static shapes ———
const EAR_R = 'M 102,-36 C 130,-54 152,-22 138,4 C 131,19 116,26 104,18 Z'
const EAR_R_INNER = 'M 110,-22 C 128,-30 136,-8 124,4'
const EAR_R_SHADE = 'M 110,-22 C 128,-30 136,-8 124,4 C 118,0 114,-6 110,-22 Z'

const TUFT_R =
  'M 84,-100 Q 112,-122 136,-112 Q 120,-104 124,-96 Q 148,-102 160,-86 Q 140,-84 132,-76 Q 158,-70 162,-50 Q 142,-58 132,-52 Q 150,-38 146,-20 Q 132,-34 118,-30 L 96,-28 Z'
const TUFT_L =
  'M -84,-98 Q -110,-124 -138,-114 Q -122,-104 -126,-94 Q -152,-98 -158,-80 Q -140,-80 -132,-72 Q -156,-62 -156,-44 Q -140,-52 -130,-48 Q -146,-32 -140,-16 Q -128,-30 -116,-28 L -96,-28 Z'
const TUFT_STRANDS_R = 'M 100,-92 Q 124,-98 140,-94 M 104,-72 Q 130,-74 148,-64 M 104,-52 Q 124,-50 140,-36'
const TUFT_STRANDS_L = 'M -100,-90 Q -124,-98 -142,-96 M -104,-70 Q -130,-72 -146,-62 M -104,-50 Q -124,-48 -134,-34'

const BROW_R = 'M 14,-62 C 16,-78 40,-90 62,-83 C 72,-80 80,-73 82,-64 C 76,-69 70,-68 66,-70 C 62,-64 54,-66 48,-64 C 40,-67 34,-60 26,-62 C 22,-58 18,-59 14,-62 Z'
const BROW_STRANDS_R = 'M 24,-70 Q 44,-80 64,-76 M 34,-66 Q 52,-72 70,-70'

const NOSE =
  'M -9,-22 C -14,-6 -34,0 -32,18 C -30,35 -12,38 0,32 C 12,38 30,35 32,18 C 34,0 14,-6 9,-22 C 4,-26 -4,-26 -9,-22 Z'
const NOSE_SHADE = 'M 30,10 C 34,26 22,38 4,33 C 18,32 28,24 30,10 Z'

const MOUSTACHE_R =
  'M 0,30 C 10,24 30,22 46,28 C 60,33 72,36 82,26 C 86,20 94,20 95,28 C 96,40 86,50 72,50 Q 72,61 61,62 Q 57,56 53,56 Q 51,67 41,66 Q 38,58 33,58 Q 30,69 20,68 Q 17,60 12,60 Q 9,70 0,69'
const MOUSTACHE = `${MOUSTACHE_R} ${mirrorPath(
  // Reverse traversal of the right half, mirrored, so the outline is one closed loop.
  'L 0,69 Q 9,70 12,60 Q 17,60 20,68 Q 30,69 33,58 Q 38,58 41,66 Q 51,67 53,56 Q 57,56 61,62 Q 72,61 72,50 C 86,50 96,40 95,28 C 94,20 86,20 82,26 C 72,36 60,33 46,28 C 30,22 10,24 0,30'
).replace(/^L 0,69 /, '')} Z`
const MOUSTACHE_STRANDS =
  'M 8,38 Q 28,32 50,40 M 12,50 Q 34,44 62,48 M 60,36 Q 74,40 86,32 M -8,38 Q -28,32 -50,40 M -12,50 Q -34,44 -62,48 M -60,36 Q -74,40 -86,32'
const MOUSTACHE_DARK = 'M 4,58 Q 22,52 40,56 M -4,58 Q -22,52 -40,56'

const TORSO = 'M -64,112 C -98,124 -110,200 -68,214 C -32,226 32,226 68,214 C 110,200 98,124 64,112 Z'
const TORSO_SHADE = 'M 60,124 C 90,140 96,196 66,210 C 40,218 20,220 0,221 C 50,206 74,170 60,124 Z'
const VNECK = 'M -30,110 L 0,158 L 30,110 Z'
const COLLAR_L = 'M -30,110 L -4,124 L -22,136 Z'
const COLLAR_R = 'M 30,110 L 4,124 L 22,136 Z'
const BOW_L = 'M -3,128 C -16,114 -34,116 -34,128 C -34,141 -16,142 -3,128 Z'
const BOW_R = 'M 3,128 C 16,114 34,116 34,128 C 34,141 16,142 3,128 Z'

const HAND =
  'M -9,3 C -14,-6 -15,-14 -12,-19 C -13,-27 -6,-31 -3,-24 C -3,-33 6,-34 6,-25 C 8,-32 16,-30 14,-21 C 18,-25 22,-19 18,-13 C 17,-5 13,2 7,4 Z'
const THUMB = 'M -10,-7 C -20,-12 -25,-5 -20,-1 C -17,2 -12,1 -9,-1 Z'
const HAND_LINES = 'M -3,-23 L -3,-15 M 6,-24 L 5.5,-15'

const DROP = 'M 0,-9 C 4,-3 7,1 7,5 A 7,7 0 1 1 -7,5 C -7,1 -4,-3 0,-9 Z'

export interface UncleSvgProps {
  attrs: Record<PartKey, Attrs>
  uid: string
  /** Pixel width; height follows the viewBox aspect ratio. */
  width: number
  part?: RefFn
  title?: string
}

/** Pure markup (no hooks) so it can be rendered statically for icons. */
export const UncleSvg = forwardRef(function UncleSvg(
  { attrs: A, uid, width, part, title }: UncleSvgProps,
  ref: Ref<SVGSVGElement>
) {
  const r = (k: PartKey) => (part ? part(k) : undefined)
  const id = (s: string): string => `${uid}-${s}`
  const url = (s: string): string => `url(#${id(s)})`
  const height = (width * VIEWBOX.h) / VIEWBOX.w
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      width={width}
      height={height}
      role="img"
      aria-label={title ?? 'The Uncle'}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <clipPath id={id('head')}>
          <path ref={r('headClip')} {...A.headClip} />
        </clipPath>
        <clipPath id={id('mouth')}>
          <path ref={r('mouthClip')} {...A.mouthClip} />
        </clipPath>
        <clipPath id={id('eyeL')}>
          <ellipse cx={-40} cy={-30} rx={20} ry={22} />
        </clipPath>
        <clipPath id={id('eyeR')}>
          <ellipse cx={40} cy={-30} rx={20} ry={22} />
        </clipPath>
        <clipPath id={id('torso')}>
          <path d={TORSO} />
        </clipPath>
      </defs>

      <g ref={r('root')} {...A.root}>
        {/* ——— body (behind the head) ——— */}
        <g ref={r('body')} {...A.body}>
          <Inked d={TORSO} fill={C.vest} w={9} />
          <g clipPath={url('torso')}>
            {/* argyle diamonds — the most uncle-ish knitwear */}
            <path
              d="M -50,150 L -34,172 L -50,194 L -66,172 Z M 0,170 L 16,192 L 0,214 L -16,192 Z M 50,150 L 66,172 L 50,194 L 34,172 Z"
              fill={C.vestLight}
            />
            <path d="M -86,140 L 86,230 M 86,140 L -86,230" stroke={C.vestShade} strokeWidth={2.5} strokeDasharray="6 5" />
            <path d={TORSO_SHADE} fill={C.vestShade} opacity={0.75} />
          </g>
          <Inked d={VNECK} fill={C.shirt} w={6} />
          <Inked d={COLLAR_L} fill={C.shirt} w={5} />
          <Inked d={COLLAR_R} fill={C.shirt} w={5} />
          <path d="M 6,120 L 22,134 L 26,124 Z" fill={C.shirtShade} />
          <Inked d={BOW_L} fill={C.bow} w={6} />
          <Inked d={BOW_R} fill={C.bow} w={6} />
          <circle cx={-20} cy={126} r={2.6} fill="#fff" opacity={0.9} />
          <circle cx={-14} cy={134} r={2} fill="#fff" opacity={0.9} />
          <circle cx={18} cy={124} r={2.4} fill="#fff" opacity={0.9} />
          <circle cx={24} cy={133} r={2} fill="#fff" opacity={0.9} />
          <Inked d="M -7,122 Q 0,118 7,122 L 7,134 Q 0,138 -7,134 Z" fill="#b8322b" w={5} />
          <circle cx={0} cy={176} r={3.6} fill={C.ink} />
          <circle cx={0} cy={198} r={3.6} fill={C.ink} />
        </g>

        {/* ——— head ——— */}
        <g ref={r('head')} {...A.head}>
          <g ref={r('hair')} {...A.hair}>
            <Inked d={TUFT_R} fill={C.hair} w={7} />
            <Inked d={TUFT_L} fill={C.hair} w={7} />
            <path d={TUFT_STRANDS_R} stroke={C.hairLight} strokeWidth={3} fill="none" strokeLinecap="round" />
            <path d={TUFT_STRANDS_L} stroke={C.hairLight} strokeWidth={3} fill="none" strokeLinecap="round" />
          </g>
          <g ref={r('ears')} {...A.ears}>
            <Inked d={EAR_R} fill={C.skin} w={8} />
            <path d={EAR_R_SHADE} fill={C.skinShade} />
            <path d={EAR_R_INNER} stroke={C.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
            <Inked d={mirrorPath(EAR_R)} fill={C.skin} w={8} off="translate(-0.6 1.9)" />
            <path d={mirrorPath(EAR_R_SHADE)} fill={C.skinShade} />
            <path d={mirrorPath(EAR_R_INNER)} stroke={C.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
          </g>

          {/* skull + jaw silhouette (procedural: chin drops with the jaw, jowls puff while chewing) */}
          <path
            ref={r('headInk')}
            {...A.headInk}
            fill={C.ink}
            stroke={C.ink}
            strokeWidth={9}
            strokeLinejoin="round"
            transform={INK_OFF}
          />
          <g ref={r('pouchInkL')} {...A.pouchInkL}>
            <circle r={27} fill={C.ink} transform="translate(0.6 1.9)" />
          </g>
          <g ref={r('pouchInkR')} {...A.pouchInkR}>
            <circle r={27} fill={C.ink} transform="translate(2.4 2.2)" />
          </g>
          <path ref={r('headFill')} {...A.headFill} fill={C.skinShade} />
          <g ref={r('pouchL')} {...A.pouchL}>
            <circle r={23} fill={C.skin} />
            <ellipse cx={-6} cy={-8} rx={8} ry={5} fill={C.skinLight} transform="rotate(-30 -6 -8)" />
          </g>
          <g ref={r('pouchR')} {...A.pouchR}>
            <circle r={23} fill={C.skinShade} />
          </g>
          <g clipPath={url('head')}>
            <ellipse ref={r('shade')} cx={-14} {...A.shade} fill={C.skin} />
            <g ref={r('shine')} {...A.shine}>
              <ellipse cx={-42} cy={-100} rx={26} ry={11} transform="rotate(-28 -42 -100)" fill={C.skinLight} />
              <ellipse cx={-44} cy={-102} rx={13} ry={5} transform="rotate(-28 -44 -102)" fill="#fff6ec" />
              <circle cx={-14} cy={-114} r={4} fill="#fff6ec" />
            </g>
            {/* editorial cross-hatching on the shadow side */}
            <path
              d="M 92,-64 l 12,-10 M 96,-48 l 13,-11 M 98,-32 l 13,-11 M 98,-16 l 13,-11 M 96,0 l 13,-11 M 92,16 l 12,-10"
              stroke={C.skinDeep}
              strokeWidth={2.4}
              strokeLinecap="round"
              opacity={0.75}
            />
            <g ref={r('wrinkles')} {...A.wrinkles}>
              <path
                d="M -34,-100 Q -2,-112 30,-101 M -24,-89 Q 0,-97 22,-89 M 34,-94 Q 44,-96 50,-92"
                stroke={C.skinDeep}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
              />
            </g>
          </g>

          {/* wild comb-over hairs (secondary motion) */}
          <g ref={r('combover')} {...A.combover}>
            <path
              d="M 6,-129 C 2,-160 36,-176 40,-152 C 43,-137 22,-134 25,-147 M -10,-129 C -16,-148 -32,-152 -40,-142 M -22,-126 C -27,-140 -24,-153 -12,-160"
              stroke={C.ink}
              strokeWidth={3.4}
              fill="none"
              strokeLinecap="round"
            />
          </g>

          {/* sweat drops (struggle / choke) */}
          <g ref={r('sweat')} {...A.sweat}>
            <g ref={r('drop1')} {...A.drop1}>
              <Inked d={DROP} fill={C.sweat} w={5} />
              <ellipse cx={-2} cy={5} rx={2} ry={3} fill="#fff" />
            </g>
            <g ref={r('drop2')} {...A.drop2}>
              <Inked d={DROP} fill={C.sweat} w={5} />
              <ellipse cx={-2} cy={5} rx={2} ry={3} fill="#fff" />
            </g>
          </g>

          {/* ——— face (parallax layers: deeper parts move less) ——— */}
          <g ref={r('cheeks')} {...A.cheeks}>
            <path
              d="M -30,26 Q -46,36 -52,52 M 30,26 Q 46,36 52,52"
              stroke={C.skinDeep}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
            />
            <ellipse ref={r('blushL')} {...A.blushL} cx={0} cy={0} rx={21} ry={13} fill={C.blush} />
            <ellipse ref={r('blushR')} {...A.blushR} cx={0} cy={0} rx={21} ry={13} fill={C.blush} />
          </g>

          <g ref={r('mouth')} {...A.mouth}>
            <path ref={r('mouthFill')} {...A.mouthFill} fill={C.throat} />
            <g clipPath={url('mouth')}>
              <ellipse ref={r('throat')} cx={0} {...A.throat} fill={C.throatDeep} />
              <g ref={r('uvula')} {...A.uvula}>
                <path d="M -5,0 C -5,8 -4,14 0,15 C 4,14 5,8 5,0 Z" fill="#c23a4b" />
              </g>
              <g ref={r('tongue')} {...A.tongue}>
                <path d="M -44,8 C -44,-16 -18,-24 0,-15 C 18,-24 44,-16 44,8 Z" fill={C.tongue} />
                <path d="M 0,-13 Q 2,-6 0,0" stroke={C.tongueShade} strokeWidth={3} fill="none" strokeLinecap="round" />
                <path d="M -30,-12 Q -36,-6 -36,2" stroke="#ff9aa5" strokeWidth={3} fill="none" strokeLinecap="round" />
              </g>
              <g ref={r('lowerTeeth')} {...A.lowerTeeth}>
                <path
                  d="M -30,2 L -30,-8 Q -24,-12 -18,-8 L -18,2 Z M 14,2 L 14,-9 Q 20,-13 26,-9 L 26,2 Z"
                  fill={C.teeth}
                  stroke={C.ink}
                  strokeWidth={1.6}
                />
              </g>
              <g ref={r('upperTeeth')} {...A.upperTeeth}>
                <path d="M -46,-6 L 46,-6 L 44,16 Q 0,24 -44,16 Z" fill={C.teeth} stroke={C.ink} strokeWidth={2} />
                <path d="M 8,-4 L 22,-4 L 21,18 Q 15,20 9,19 Z" fill={C.gold} stroke={C.ink} strokeWidth={1.6} />
                <path d="M -24,0 L -24,18 M -8,0 L -8,20 M 36,0 L 35,16" stroke={C.ink} strokeWidth={1.6} />
                <path d="M 11,2 L 13,12" stroke="#fff4c4" strokeWidth={2} strokeLinecap="round" />
              </g>
            </g>
            <path
              ref={r('mouthLine')}
              {...A.mouthLine}
              fill="none"
              stroke={C.ink}
              strokeWidth={5}
              strokeLinejoin="round"
            />
            <path ref={r('lip')} {...A.lip} stroke={C.skinDeep} strokeWidth={3.2} fill="none" strokeLinecap="round" />
          </g>

          <g ref={r('chin')} {...A.chin}>
            <path d="M -9,0 Q 0,5 9,0" stroke={C.skinDeep} strokeWidth={3} fill="none" strokeLinecap="round" />
          </g>

          <g ref={r('moustache')} {...A.moustache}>
            <g transform="translate(0 -2)">
              <Inked d={MOUSTACHE} fill={C.hair} w={8} />
            <path d={MOUSTACHE_STRANDS} stroke={C.hairLight} strokeWidth={3} fill="none" strokeLinecap="round" />
            <path d={MOUSTACHE_DARK} stroke={C.hairDark} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            </g>
          </g>

          <g ref={r('nose')} {...A.nose}>
            <Inked d={NOSE} fill={C.nose} w={8} />
            <path d={NOSE_SHADE} fill={C.noseShade} />
            <ellipse cx={-12} cy={6} rx={8} ry={5.5} transform="rotate(-20 -12 6)" fill="#ffe4d2" />
            <circle cx={-4} cy={-8} r={2.4} fill="#ffe4d2" />
            <path d="M -15,26 Q -10,31 -5,28 M 5,28 Q 10,31 15,26" stroke={C.ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          </g>

          <g ref={r('mole')} {...A.mole}>
            <g ref={r('moleHair')} {...A.moleHair}>
              <path
                d="M -45,11 C -47,1 -38,-1 -41,-9 C -42,-14 -36,-16 -34,-12"
                stroke={C.ink}
                strokeWidth={2.2}
                fill="none"
                strokeLinecap="round"
              />
            </g>
            <ellipse cx={-44} cy={17} rx={7.4} ry={6.8} fill={C.ink} transform="translate(1 1.4)" />
            <ellipse cx={-44} cy={17} rx={6.6} ry={6} fill="#6e3b26" />
            <ellipse cx={-42} cy={19} rx={3.4} ry={2.6} fill="#55291a" />
            <circle cx={-46.4} cy={14.6} r={1.8} fill="#c08560" />
          </g>

          <g ref={r('eyes')} {...A.eyes}>
            {(['L', 'R'] as const).map((s) => {
              const cx = s === 'L' ? -40 : 40
              return (
                <g key={s}>
                  <g ref={r(s === 'L' ? 'scleraL' : 'scleraR')} {...(s === 'L' ? A.scleraL : A.scleraR)}>
                    <ellipse cx={cx} cy={-30} rx={20} ry={22} fill={C.sclera} />
                    <g clipPath={url(s === 'L' ? 'eyeL' : 'eyeR')}>
                      <g ref={r(s === 'L' ? 'pupilL' : 'pupilR')} {...(s === 'L' ? A.pupilL : A.pupilR)}>
                        <circle cx={cx} cy={-29} r={9} fill={C.ink} />
                        <circle cx={cx - 3} cy={-32.5} r={3} fill="#fff" />
                        <circle cx={cx + 3} cy={-26} r={1.3} fill="#fff" />
                      </g>
                      <path ref={r(s === 'L' ? 'lidL' : 'lidR')} {...(s === 'L' ? A.lidL : A.lidR)} fill={C.skin} />
                      <path
                        ref={r(s === 'L' ? 'lidLineL' : 'lidLineR')}
                        {...(s === 'L' ? A.lidLineL : A.lidLineR)}
                        stroke={C.ink}
                        strokeWidth={3.2}
                        fill="none"
                        strokeLinecap="round"
                      />
                    </g>
                    <ellipse cx={cx} cy={-30} rx={20} ry={22} fill="none" stroke={C.ink} strokeWidth={2.4} />
                  </g>
                  <g ref={r(s === 'L' ? 'happyL' : 'happyR')} {...(s === 'L' ? A.happyL : A.happyR)}>
                    <path
                      d={`M ${cx - 15},-24 Q ${cx},-46 ${cx + 15},-24`}
                      stroke={C.ink}
                      strokeWidth={5.5}
                      fill="none"
                      strokeLinecap="round"
                    />
                  </g>
                </g>
              )
            })}
            {/* tired-uncle eye bags */}
            <path
              d="M -56,-2 Q -40,6 -24,-2 M 24,-1 Q 40,8 57,-1"
              stroke={C.skinDeep}
              strokeWidth={2.6}
              fill="none"
              strokeLinecap="round"
            />
            {/* round glasses */}
            <g>
              <path
                d="M -72,-34 L -105,-28 M 72,-34 L 105,-28"
                stroke={C.frame}
                strokeWidth={5}
                strokeLinecap="round"
              />
              <circle cx={-40} cy={-30} r={28} fill={C.lens} opacity={0.22} />
              <circle cx={40} cy={-30} r={28} fill={C.lens} opacity={0.22} />
              <path
                d="M -40,-61 A 31,31 0 1 0 -39.99,-61 Z M -40,-55.5 A 25.5,25.5 0 1 1 -40.01,-55.5 Z M 40,-61 A 31,31 0 1 0 40.01,-61 Z M 40,-55.5 A 25.5,25.5 0 1 1 39.99,-55.5 Z"
                fill={C.ink}
                fillRule="evenodd"
                transform="translate(1.2 1.6)"
              />
              <path
                d="M -40,-61 A 31,31 0 1 0 -39.99,-61 Z M -40,-55.5 A 25.5,25.5 0 1 1 -40.01,-55.5 Z M 40,-61 A 31,31 0 1 0 40.01,-61 Z M 40,-55.5 A 25.5,25.5 0 1 1 39.99,-55.5 Z"
                fill={C.frame}
                fillRule="evenodd"
              />
              <path d="M -12,-38 Q 0,-48 12,-38" stroke={C.frame} strokeWidth={5.5} fill="none" strokeLinecap="round" />
              <path
                d="M -58,-42 Q -54,-50 -46,-52 M 22,-42 Q 26,-50 34,-52"
                stroke="#fff"
                strokeWidth={3.6}
                fill="none"
                strokeLinecap="round"
                opacity={0.85}
              />
              <circle cx={-59} cy={-35} r={2} fill="#fff" opacity={0.85} />
              <circle cx={21} cy={-35} r={2} fill="#fff" opacity={0.85} />
            </g>
          </g>

          <g ref={r('brows')} {...A.brows}>
            <g ref={r('browR')} {...A.browR}>
              <Inked d={BROW_R} fill={C.hair} w={7} />
              <path d={BROW_STRANDS_R} stroke={C.hairLight} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            </g>
            <g ref={r('browL')} {...A.browL}>
              <Inked d={mirrorPath(BROW_R)} fill={C.hair} w={7} off="translate(-0.6 1.9)" />
              <path d={mirrorPath(BROW_STRANDS_R)} stroke={C.hairLight} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            </g>
          </g>
        </g>

        {/* ——— rubber-hose arms + small hands (in front) ——— */}
        {(['L', 'R'] as const).map((s) => (
          <g key={s}>
            <path
              ref={r(s === 'L' ? 'armLInk' : 'armRInk')}
              {...(s === 'L' ? A.armLInk : A.armRInk)}
              stroke={C.ink}
              strokeWidth={21}
              fill="none"
              strokeLinecap="round"
            />
            <path
              ref={r(s === 'L' ? 'armLSleeve' : 'armRSleeve')}
              {...(s === 'L' ? A.armLSleeve : A.armRSleeve)}
              stroke={C.shirt}
              strokeWidth={13}
              fill="none"
              strokeLinecap="round"
            />
            <g ref={r(s === 'L' ? 'handL' : 'handR')} {...(s === 'L' ? A.handL : A.handR)}>
              <ellipse cx={0} cy={5} rx={11} ry={6} fill={C.ink} transform="translate(1 1.5)" />
              <ellipse cx={0} cy={5} rx={9.5} ry={4.6} fill="#fff" />
              <path d={THUMB} fill={C.ink} stroke={C.ink} strokeWidth={6} strokeLinejoin="round" transform="translate(1 1.4)" />
              <path d={HAND} fill={C.ink} stroke={C.ink} strokeWidth={6} strokeLinejoin="round" transform="translate(1 1.4)" />
              <path d={HAND} fill={C.skin} />
              <path d={THUMB} fill={C.skin} />
              <path d="M 14,-20 C 18,-12 14,-2 7,3 C 12,-4 13,-12 14,-20 Z" fill={C.skinShade} />
              <path d={HAND_LINES} stroke={C.skinDeep} strokeWidth={2} strokeLinecap="round" />
            </g>
          </g>
        ))}
      </g>
    </svg>
  )
})
