// The entry of components/bundle.js: the real components of apps/web/src, as window.Bto.
// Only ModuleTile (no component in the code) and BtoProvider (a stand-in for the app's providers)
// are written here; the bell and the camera are replaced at build time, see bundle.cjs.
import '@/lib/i18n';

// The root scale of the main app (index.css: html[data-app='web']).
document.documentElement.setAttribute('data-app', 'web');

export * from '@/components/ui/alert';
export * from '@/components/ui/badge';
export * from '@/components/ui/button';
export * from '@/components/ui/card';
export * from '@/components/ui/checkbox';
export * from '@/components/ui/dialog';
export * from '@/components/ui/dropdown-menu';
export * from '@/components/ui/input';
export * from '@/components/ui/label';
export * from '@/components/ui/select';
export * from '@/components/ui/separator';
export * from '@/components/ui/sheet';
export * from '@/components/ui/switch';
export * from '@/components/ui/table';
export * from '@/components/ui/tabs';
export * from '@/components/ui/textarea';

export * from '@/components/checkbox-group';
export * from '@/components/column-chooser';
export * from '@/components/combobox';
export * from '@/components/confirm-dialog';
export * from '@/components/date-input';
export * from '@/components/detail';
export * from '@/components/field-error';
export * from '@/components/filter-panel';
export * from '@/components/filter-tree';
export * from '@/components/form';
export * from '@/components/list';
export * from '@/components/native-select';
export * from '@/components/page-header';
export * from '@/components/problem-alert';
export * from '@/components/record-sheet';
export * from '@/components/scan-box';
export * from '@/components/selection-bar';
export * from '@/components/sticky-actions';
export * from '@/components/toaster';

export { TopBar } from '@/app/top-bar';
export { BrandMark } from '@/pos/components/layout';
export { CategoryIcon, CategoryIconField } from '@/features/catalog/category-icon';
export { CATEGORY_ICON_KEYS, suggestCategoryIcon } from '@tugeel/shared/category-icons';
export { pauseToasts, resumeToasts, toast } from '@/lib/toast';
export { cn } from '@/lib/utils';

export { BtoProvider } from './provider';
export { ModuleTile } from './module-tile';
export * as icons from './icons';
