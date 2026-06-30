<script lang="ts">
  import type { ComponentType } from 'svelte';
  import FileUser from 'lucide-svelte/icons/file-user';
  import UserPen from 'lucide-svelte/icons/user-pen';
  import UserSearch from 'lucide-svelte/icons/user-search';
  import type { IconName } from './icon-names';
  import {
    AlertTriangle,
    ArrowLeft,
    Bold,
    CalendarDays,
    CalendarPlus,
    ChartNoAxesColumn,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    ClipboardPlus,
    Building2,
    Eye,
    EyeOff,
    FilePlus,
    FileText,
    FlaskConical,
    FolderOpen,
    HardDrive,
    House,
    Info,
    Italic,
    LayoutGrid,
    Link2,
    List,
    ListOrdered,
    LoaderCircle,
    Lock,
    LogOut,
    Pencil,
    Pill,
    Receipt,
    RotateCcw,
    Save,
    Search,
    Settings,
    Trash2,
    Underline,
    User,
    UserPlus,
    Users
  } from 'lucide-svelte';

  const iconMap: Record<IconName, ComponentType> = {
    'alert-triangle': AlertTriangle,
    'arrow-left': ArrowLeft,
    bold: Bold,
    building: Building2,
    'calendar-days': CalendarDays,
    'calendar-plus': CalendarPlus,
    chart: ChartNoAxesColumn,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'clipboard-list': ClipboardList,
    'clipboard-plus': ClipboardPlus,
    eye: Eye,
    'eye-off': EyeOff,
    'file-plus': FilePlus,
    'file-user': FileUser,
    'file-text': FileText,
    flask: FlaskConical,
    'folder-open': FolderOpen,
    'hard-drive': HardDrive,
    house: House,
    info: Info,
    italic: Italic,
    'layout-grid': LayoutGrid,
    link: Link2,
    list: List,
    'list-ordered': ListOrdered,
    loader: LoaderCircle,
    lock: Lock,
    'log-out': LogOut,
    pencil: Pencil,
    pill: Pill,
    receipt: Receipt,
    'rotate-ccw': RotateCcw,
    save: Save,
    search: Search,
    settings: Settings,
    trash: Trash2,
    underline: Underline,
    user: User,
    'user-pen': UserPen,
    'user-plus': UserPlus,
    'user-search': UserSearch,
    users: Users
  };

  export let name: IconName;
  export let size = 20;
  export let strokeWidth = 2;
  export let absoluteStrokeWidth = false;
  export let color = 'currentColor';
  export let className = '';

  $: resolvedClassName = className ? `icon-svg ${className}` : 'icon-svg';
</script>

<svelte:component
  this={iconMap[name]}
  {size}
  {strokeWidth}
  {absoluteStrokeWidth}
  {color}
  class={resolvedClassName}
  {...$$restProps}
/>
