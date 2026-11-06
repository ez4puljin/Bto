import { useMemo } from 'react';
import { useHasPermission } from '@/app/auth-context';
import { useCategories } from '@/features/catalog/api';
import { categoryPaths, categoryTree } from '@/features/catalog/category-tree';
import { useSuppliersByIds } from '@/features/partners/api';
import { useTills } from '@/features/pos/api';
import { useBoardTree } from '@/features/sales/pipelines-api';
import { useSegments } from '@/features/segments/api';
import type { DiscountProgram } from './api';

export interface Choice {
  id: number;
  label: string;
}

/** Every category by its path, parents before their children. */
export function useCategoryChoices(): Choice[] {
  const categories = useCategories();
  return useMemo(
    () =>
      categoryTree(categories.data ?? []).map((node) => ({
        id: node.category.id,
        label: node.path,
      })),
    [categories.data],
  );
}

export function useSegmentChoices(): Choice[] {
  const segments = useSegments('PRODUCT');
  return useMemo(
    () => (segments.data ?? []).map((segment) => ({ id: segment.id, label: segment.name })),
    [segments.data],
  );
}

/** Every live pipeline, «Самбар / Дамжлага»; a card's price freezes on its pipeline. */
export function usePipelineChoices(): Choice[] {
  const boards = useBoardTree();
  return useMemo(
    () =>
      (boards.data ?? []).flatMap((board) =>
        board.pipelines
          .filter((pipeline) => pipeline.archivedAt === null)
          .map((pipeline) => ({ id: pipeline.id, label: `${board.name} / ${pipeline.name}` })),
      ),
    [boards.data],
  );
}

export function useTillChoices(): Choice[] {
  const canRead = useHasPermission('pos.read');
  const tills = useTills(undefined, canRead);
  return useMemo(
    () => (tills.data ?? []).map((till) => ({ id: till.id, label: `${till.code} ${till.name}` })),
    [tills.data],
  );
}

/** A program's targets, exclusions and places by name, for reading it. */
export function useProgramNames(program: DiscountProgram) {
  const categories = useCategories();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const segments = useSegmentChoices();
  const pipelines = usePipelineChoices();
  const tills = useTillChoices();
  const supplierIds =
    program.targetKind === 'SUPPLIER' ? [...program.targetIds, ...program.excludeTargetIds] : [];
  const suppliers = useSuppliersByIds(supplierIds);
  const products = useMemo(
    () => new Map(program.namedProducts.map((own) => [own.id, `${own.sku} ${own.name}`])),
    [program.namedProducts],
  );
  const named = (choices: readonly Choice[], id: number) =>
    choices.find((choice) => choice.id === id)?.label ?? String(id);
  const ofKind = (id: number): string => {
    switch (program.targetKind) {
      case 'PRODUCT':
        return products.get(id) ?? String(id);
      case 'CATEGORY':
        return paths.get(id) ?? String(id);
      case 'SUPPLIER':
        return suppliers.data?.find((row) => row.id === id)?.name ?? String(id);
      case 'SEGMENT':
        return named(segments, id);
      default:
        return String(id);
    }
  };
  return {
    targets: program.targetIds.map(ofKind),
    excludedTargets: program.excludeTargetIds.map(ofKind),
    excludedProducts: program.excludeProductIds.map((id) => products.get(id) ?? String(id)),
    pipelines: program.pipelineIds.map((id) => named(pipelines, id)),
    tills: program.tillIds.map((id) => named(tills, id)),
  };
}
