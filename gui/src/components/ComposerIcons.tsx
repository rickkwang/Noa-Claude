import type { SVGProps } from "react"

export function ComposerFolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" className="shrink-0" aria-hidden="true" {...props}>
      <path d="M5.55957 2.14136C6.06503 2.14136 6.55801 2.30207 6.9668 2.59937L7.81836 3.21851C8.04765 3.38523 8.32392 3.47534 8.60742 3.47534H11.9668C13.2877 3.47534 14.3584 4.54606 14.3584 5.86694V11.4666C14.3584 12.7874 13.2877 13.8582 11.9668 13.8582H4.0332C2.71253 13.8579 1.6416 12.7873 1.6416 11.4666V4.53296C1.64185 3.21244 2.71268 2.1416 4.0332 2.14136H5.55957ZM2.69238 7.85913V11.4666C2.69238 12.2074 3.29243 12.8081 4.0332 12.8083H11.9668C12.7078 12.8083 13.3086 12.2075 13.3086 11.4666V7.85913H2.69238ZM4.0332 3.19214C3.29258 3.19238 2.69263 3.79234 2.69238 4.53296V6.80835H13.3086V5.86694C13.3086 5.12596 12.7078 4.52515 11.9668 4.52515H8.60742C8.10196 4.52515 7.60898 4.36541 7.2002 4.06812L6.34863 3.448C6.11941 3.28145 5.84292 3.19214 5.55957 3.19214H4.0332Z" fillRule="evenodd" clipRule="evenodd" fill="currentColor"/>
    </svg>
  )
}

// Glyph outlines in a 1000-unit em, y axis up, hence the flip.
function ComposerGlyph({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 1000 1000" fill="currentColor" className="shrink-0" aria-hidden="true" {...props}>
      <path transform="matrix(1 0 0 -1 0 1000)" d={d} />
    </svg>
  )
}

export function ComposerPlusIcon(props: SVGProps<SVGSVGElement>) {
  return <ComposerGlyph d="M471 794Q471 806 479.5 814.5Q488 823 500 823Q512 823 520.5 814.5Q529 806 529 794V206Q529 194 520.5 185.5Q512 177 500 177Q488 177 479.5 185.5Q471 194 471 206ZM206 471Q194 471 185.5 479.5Q177 488 177 500Q177 512 185.5 520.5Q194 529 206 529H794Q806 529 814.5 520.5Q823 512 823 500Q823 488 814.5 479.5Q806 471 794 471Z" {...props} />
}

export function ComposerReturnIcon(props: SVGProps<SVGSVGElement>) {
  return <ComposerGlyph d="M789 769Q789 781 798 789.5Q807 798 819 798Q831 798 839.5 789.5Q848 781 848 769V591L847 523L843 497L834 473Q815 435 777 416L753 407L727 403L659 402H181V461H659L722 462L740 464L751 468Q771 479 782 499L786 510L788 528L789 591ZM402 252Q411 243 411 231Q411 219 402 211Q393 202 381 202Q369 202 361 211L161 411Q152 419 152 431Q152 443 161 452L361 652Q369 661 381 661Q393 661 402 652Q411 643 411 631Q411 619 402 611L223 431Z" {...props} />
}

export function ComposerStopIcon(props: SVGProps<SVGSVGElement>) {
  return <ComposerGlyph d="M231 609Q231 651 232.5 674.5Q234 698 242 714Q257 743 286 758Q302 766 325.5 767.5Q349 769 391 769H609Q651 769 674.5 767.5Q698 766 714 758Q743 743 758 714Q766 698 767.5 674.5Q769 651 769 609V391Q769 349 767.5 325.5Q766 302 758 286Q743 257 714 242Q698 234 674.5 232.5Q651 231 609 231H391Q349 231 325.5 232.5Q302 234 286 242Q257 257 242 286Q234 302 232.5 325.5Q231 349 231 391Z" {...props} />
}

export function ComposerChevronIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" className="shrink-0" aria-hidden="true" {...props}>
      <path d="M10.2954 6.54537C10.5003 6.3404 10.8325 6.34051 11.0376 6.54537C11.2426 6.7504 11.2426 7.08253 11.0376 7.28756L8.60689 9.71822C8.27169 10.0534 7.72823 10.0534 7.39303 9.71822L4.96236 7.28756C4.75734 7.08253 4.75734 6.7504 4.96236 6.54537C5.16739 6.34035 5.49952 6.34035 5.70455 6.54537L7.99947 8.84029L10.2954 6.54537Z" fill="currentColor"/>
    </svg>
  )
}

export function ComposerBranchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 20 20" fill="none" className="shrink-0" aria-hidden="true" {...props}>
      <circle cx={5.4165} cy={5} r={1.875} stroke="currentColor" strokeWidth={1.33} />
      <circle cx={5.4165} cy={15} r={1.875} stroke="currentColor" strokeWidth={1.33} />
      <circle cx={14.5833} cy={5} r={1.875} stroke="currentColor" strokeWidth={1.33} />
      <path d="M5.4165 6.66664V13.3333" stroke="currentColor" strokeWidth={1.33} strokeLinejoin="round" />
      <path d="M5.41658 12.5V11.6667C5.41658 10.7462 6.16278 10 7.08325 10H12.9166C13.8371 10 14.5833 9.25381 14.5833 8.33333V7.5" stroke="currentColor" strokeWidth={1.33} strokeLinejoin="round" />
    </svg>
  )
}
