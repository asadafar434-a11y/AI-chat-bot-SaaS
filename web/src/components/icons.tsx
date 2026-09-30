// Иконки интерфейса — пути Lucide (https://lucide.dev), как в прототипе design-system/prototype: сетка 24,
// линия 2, скруглённые концы и углы. Пакет lucide-react не ставим — рисунки лежат здесь, имена прежние,
// чтобы экраны не менялись. Источник — lucide-static 1.48.0, лицензия ISC — в icons-lucide-license.txt рядом.
// Имя в Lucide — в комментарии над каждой иконкой: по нему новую иконку легко добавить из того же набора.
import { createElement, type ComponentType, type SVGProps } from "react";

type Shape = readonly ["path" | "circle" | "rect" | "line" | "polyline" | "polygon" | "ellipse", Readonly<Record<string, string>>];
export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };
export type IconComponent = ComponentType<IconProps>;

function icon(displayName: string, shapes: readonly Shape[]): IconComponent {
  function Icon({ size = 24, strokeWidth = 2, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={props["aria-label"] ? undefined : true}
        {...props}
      >
        {shapes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

// arrow-down
export const ArrowDownIcon = /* @__PURE__ */ icon("ArrowDownIcon", [
  ["path", { d: "M12 5v14" }],
  ["path", { d: "m19 12-7 7-7-7" }],
]);

// arrow-left
export const ArrowLeftIcon = /* @__PURE__ */ icon("ArrowLeftIcon", [
  ["path", { d: "m12 19-7-7 7-7" }],
  ["path", { d: "M19 12H5" }],
]);

// arrow-right
export const ArrowRightIcon = /* @__PURE__ */ icon("ArrowRightIcon", [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "m12 5 7 7-7 7" }],
]);

// paperclip
export const AttachIcon = /* @__PURE__ */ icon("AttachIcon", [
  ["path", { d: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" }],
]);

// landmark
export const BankIcon = /* @__PURE__ */ icon("BankIcon", [
  ["path", { d: "M10 18v-7" }],
  ["path", { d: "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z" }],
  ["path", { d: "M14 18v-7" }],
  ["path", { d: "M18 18v-7" }],
  ["path", { d: "M3 22h18" }],
  ["path", { d: "M6 18v-7" }],
]);

// bell
export const BellIcon = /* @__PURE__ */ icon("BellIcon", [
  ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0" }],
  ["path", { d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" }],
]);

// briefcase
export const BriefcaseIcon = /* @__PURE__ */ icon("BriefcaseIcon", [
  ["path", { d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" }],
  ["rect", { width: "20", height: "14", x: "2", y: "6", rx: "2" }],
]);

// calculator
export const CalculatorIcon = /* @__PURE__ */ icon("CalculatorIcon", [
  ["rect", { width: "16", height: "20", x: "4", y: "2", rx: "2" }],
  ["line", { x1: "8", x2: "16", y1: "6", y2: "6" }],
  ["line", { x1: "16", x2: "16", y1: "14", y2: "18" }],
  ["path", { d: "M16 10h.01" }],
  ["path", { d: "M12 10h.01" }],
  ["path", { d: "M8 10h.01" }],
  ["path", { d: "M12 14h.01" }],
  ["path", { d: "M8 14h.01" }],
  ["path", { d: "M12 18h.01" }],
  ["path", { d: "M8 18h.01" }],
]);

// chevron-down
export const CaretDownIcon = /* @__PURE__ */ icon("CaretDownIcon", [
  ["path", { d: "m6 9 6 6 6-6" }],
]);

// chevron-left
export const CaretLeftIcon = /* @__PURE__ */ icon("CaretLeftIcon", [
  ["path", { d: "m15 18-6-6 6-6" }],
]);

// chevron-right
export const CaretRightIcon = /* @__PURE__ */ icon("CaretRightIcon", [
  ["path", { d: "m9 18 6-6-6-6" }],
]);

// chevron-up
export const CaretUpIcon = /* @__PURE__ */ icon("CaretUpIcon", [
  ["path", { d: "m18 15-6-6-6 6" }],
]);

// message-circle
export const ChatIcon = /* @__PURE__ */ icon("ChatIcon", [
  ["path", { d: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" }],
]);

// check
export const CheckIcon = /* @__PURE__ */ icon("CheckIcon", [
  ["path", { d: "M20 6 9 17l-5-5" }],
]);

// clipboard-list
export const ClipboardIcon = /* @__PURE__ */ icon("ClipboardIcon", [
  ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1" }],
  ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
  ["path", { d: "M12 11h4" }],
  ["path", { d: "M12 16h4" }],
  ["path", { d: "M8 11h.01" }],
  ["path", { d: "M8 16h.01" }],
]);

// clock
export const ClockIcon = /* @__PURE__ */ icon("ClockIcon", [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "M12 6v6l4 2" }],
]);

// x
export const CrossIcon = /* @__PURE__ */ icon("CrossIcon", [
  ["path", { d: "M18 6 6 18" }],
  ["path", { d: "m6 6 12 12" }],
]);

// monitor
export const DesktopIcon = /* @__PURE__ */ icon("DesktopIcon", [
  ["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2" }],
  ["line", { x1: "8", x2: "16", y1: "21", y2: "21" }],
  ["line", { x1: "12", x2: "12", y1: "17", y2: "21" }],
]);

// file-text
export const DocumentIcon = /* @__PURE__ */ icon("DocumentIcon", [
  ["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
  ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
  ["path", { d: "M10 9H8" }],
  ["path", { d: "M16 13H8" }],
  ["path", { d: "M16 17H8" }],
]);

// download
export const DownloadIcon = /* @__PURE__ */ icon("DownloadIcon", [
  ["path", { d: "M12 15V3" }],
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
  ["path", { d: "m7 10 5 5 5-5" }],
]);

// pencil
export const EditIcon = /* @__PURE__ */ icon("EditIcon", [
  ["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }],
  ["path", { d: "m15 5 4 4" }],
]);

// file-up
export const FileUploadIcon = /* @__PURE__ */ icon("FileUploadIcon", [
  ["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
  ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
  ["path", { d: "M12 12v6" }],
  ["path", { d: "m15 15-3-3-3 3" }],
]);

// folder
export const FolderIcon = /* @__PURE__ */ icon("FolderIcon", [
  ["path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }],
]);

// circle-question-mark
export const HelpCircleIcon = /* @__PURE__ */ icon("HelpCircleIcon", [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
  ["path", { d: "M12 17h.01" }],
]);

// house
export const HomeIcon = /* @__PURE__ */ icon("HomeIcon", [
  ["path", { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }],
  ["path", { d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }],
]);

// image
export const ImageIcon = /* @__PURE__ */ icon("ImageIcon", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2" }],
  ["circle", { cx: "9", cy: "9", r: "2" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
]);

// menu
export const MenuIcon = /* @__PURE__ */ icon("MenuIcon", [
  ["path", { d: "M4 5h16" }],
  ["path", { d: "M4 12h16" }],
  ["path", { d: "M4 19h16" }],
]);

// panel-right
export const PanelRightIcon = /* @__PURE__ */ icon("PanelRightIcon", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M15 3v18" }],
]);

// plus
export const PlusIcon = /* @__PURE__ */ icon("PlusIcon", [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "M12 5v14" }],
]);

// refresh-cw
export const RefreshIcon = /* @__PURE__ */ icon("RefreshIcon", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
  ["path", { d: "M21 3v5h-5" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
  ["path", { d: "M8 16H3v5" }],
]);

// russian-ruble
export const RubleIcon = /* @__PURE__ */ icon("RubleIcon", [
  ["path", { d: "M6 11h8a4 4 0 0 0 0-8H9v18" }],
  ["path", { d: "M6 15h8" }],
]);

// scale
export const ScalesIcon = /* @__PURE__ */ icon("ScalesIcon", [
  ["path", { d: "M12 3v18" }],
  ["path", { d: "m19 8 3 8a5 5 0 0 1-6 0zV7" }],
  ["path", { d: "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" }],
  ["path", { d: "m5 8 3 8a5 5 0 0 1-6 0zV7" }],
  ["path", { d: "M7 21h10" }],
]);

// search
export const SearchIcon = /* @__PURE__ */ icon("SearchIcon", [
  ["path", { d: "m21 21-4.34-4.34" }],
  ["circle", { cx: "11", cy: "11", r: "8" }],
]);

// send
export const SendIcon = /* @__PURE__ */ icon("SendIcon", [
  ["path", { d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" }],
  ["path", { d: "m21.854 2.147-10.94 10.939" }],
]);

// square
export const StopIcon = /* @__PURE__ */ icon("StopIcon", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
]);

// upload
export const UploadIcon = /* @__PURE__ */ icon("UploadIcon", [
  ["path", { d: "M12 3v12" }],
  ["path", { d: "m17 8-5-5-5 5" }],
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
]);

// user-check
export const UserCheckIcon = /* @__PURE__ */ icon("UserCheckIcon", [
  ["path", { d: "m16 11 2 2 4-4" }],
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
  ["circle", { cx: "9", cy: "7", r: "4" }],
]);

// user
export const UserIcon = /* @__PURE__ */ icon("UserIcon", [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
  ["circle", { cx: "12", cy: "7", r: "4" }],
]);

// wallet
export const WalletIcon = /* @__PURE__ */ icon("WalletIcon", [
  ["path", { d: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" }],
  ["path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" }],
]);

// triangle-alert
export const WarningIcon = /* @__PURE__ */ icon("WarningIcon", [
  ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
  ["path", { d: "M12 9v4" }],
  ["path", { d: "M12 17h.01" }],
]);

// sun
export const SunIcon = /* @__PURE__ */ icon("SunIcon", [
  ["circle", { cx: "12", cy: "12", r: "4" }],
  ["path", { d: "M12 2v2" }],
  ["path", { d: "M12 20v2" }],
  ["path", { d: "m4.93 4.93 1.41 1.41" }],
  ["path", { d: "m17.66 17.66 1.41 1.41" }],
  ["path", { d: "M2 12h2" }],
  ["path", { d: "M20 12h2" }],
  ["path", { d: "m6.34 17.66-1.41 1.41" }],
  ["path", { d: "m19.07 4.93-1.41 1.41" }],
]);

// moon
export const MoonIcon = /* @__PURE__ */ icon("MoonIcon", [
  ["path", { d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" }],
]);
