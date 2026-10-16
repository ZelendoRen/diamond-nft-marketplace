import { Fragment, Interface } from "ethers";

export const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 } as const;

export interface FacetCut {
  facetAddress: string;
  action: number;
  functionSelectors: string[];
}

export function selectorsOf(iface: Interface): string[] {
  return iface.fragments.filter(Fragment.isFunction).map((fragment) => fragment.selector);
}
