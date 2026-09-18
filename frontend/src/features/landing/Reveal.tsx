/**
 * 화면에 들어오면 한 번 떠오르는 요소.
 *
 * 스크롤 연출 중 가장 많이 쓰이는 것이라 한 곳에 둔다. `IntersectionObserver` 를
 * 요소마다 새로 만들지만 관찰이 끝나면 곧바로 끊는다(`once`).
 * 모션 축소에서는 `landing.css` 가 이 클래스의 transform 을 통째로 무효화한다.
 */

import type { ElementType, ReactNode } from "react";

import { useInView } from "./scrollProgress";

interface RevealProps {
  children: ReactNode;
  /** 앞의 것과 시차를 둘 때. 초 단위. */
  delay?: number;
  className?: string;
  as?: ElementType;
}

export function Reveal({ children, delay = 0, className, as: Tag = "div" }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -12% 0px" });

  return (
    <Tag
      ref={ref}
      className={`ln-reveal${inView ? " is-in" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--delay": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
