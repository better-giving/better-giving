import {
	ArrowLeft,
	ArrowUpRight,
	Bell,
	BookOpen,
	Building2,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	Clock,
	Copy,
	Database,
	ExternalLink,
	Eye,
	EyeOff,
	FileText,
	FolderHeart,
	Form,
	Globe,
	GripVertical,
	HandHeart,
	Info,
	KeyRound,
	LayoutDashboard,
	LogOut,
	Mail,
	PanelLeft,
	Pencil,
	Plus,
	Repeat,
	Search,
	Server,
	Settings,
	ShieldCheck,
	Trash2,
	TriangleAlert,
	Unplug,
	Users,
	X
} from 'lucide-react';

// the closed set of glyphs an operator surface may draw, as lucide's own components. the key is
// lucide's name for the icon and the value is the component that draws it; ./Mark.jsx is the only
// module that reads this map, and `MarkName` there is its keys.
//
// a map rather than a free `import { Plus } from 'lucide-react'` wherever a screen wants one,
// because the set is closed and nothing else makes it so: lucide ships some two thousand icons and
// every one of them is one import away, so a screen reaching past this file would widen the system
// without anybody deciding to. widening it is a name added here, which is a diff somebody reads.
//
// named imports and never `import * as`: the package sets `sideEffects: false` and each icon is its
// own module, so what is written above is what a bundler keeps. a namespace import is the whole
// library in every surface's output.
//
// there is no brand mark in here and there is no place for one. a glyph takes its ink from the text
// it stands with — lucide strokes with `currentColor` — and a company's logo is two colours of its
// own that belong to no tone ladder. ./Brand.jsx draws that, from an image.
export const GLYPHS = {
	'arrow-left': ArrowLeft,
	'arrow-up-right': ArrowUpRight,
	bell: Bell,
	'book-open': BookOpen,
	'building-2': Building2,
	check: Check,
	'chevron-down': ChevronDown,
	'chevron-right': ChevronRight,
	'chevron-up': ChevronUp,
	'circle-alert': CircleAlert,
	'circle-check': CircleCheck,
	'circle-dashed': CircleDashed,
	clock: Clock,
	copy: Copy,
	database: Database,
	'external-link': ExternalLink,
	eye: Eye,
	'eye-off': EyeOff,
	'file-text': FileText,
	'folder-heart': FolderHeart,
	form: Form,
	globe: Globe,
	'grip-vertical': GripVertical,
	'hand-heart': HandHeart,
	info: Info,
	'key-round': KeyRound,
	'layout-dashboard': LayoutDashboard,
	'log-out': LogOut,
	mail: Mail,
	'panel-left': PanelLeft,
	pencil: Pencil,
	plus: Plus,
	repeat: Repeat,
	search: Search,
	server: Server,
	settings: Settings,
	'shield-check': ShieldCheck,
	'trash-2': Trash2,
	'triangle-alert': TriangleAlert,
	unplug: Unplug,
	users: Users,
	x: X
};
