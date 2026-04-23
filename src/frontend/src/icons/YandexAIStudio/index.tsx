import type React from "react";
import { forwardRef } from "react";
import SvgYandexAIStudio from "./YandexAIStudioIcon";

export const YandexAIStudioIcon = forwardRef<
  SVGSVGElement,
  React.PropsWithChildren<{}>
>((props, ref) => {
  return <SvgYandexAIStudio ref={ref} {...props} />;
});
