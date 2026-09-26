import json
import os
import sys
import time
import numpy as np
import pandas as pd
from lif_full import Brain, DATA

ann = pd.read_csv(os.path.join(DATA, "Supplemental_file1_neuron_annotations.tsv"), sep="\t", low_memory=False)
ann["cell_type"] = ann.cell_type.fillna("")
b = Brain()

FOOD_GLOMERULI = ["DM1", "DM2", "DM4", "DP1m", "VA2", "VM2", "DM3", "DL2d", "DL2v"]


def ids(mask):
    return b.idx(ann[mask].root_id)


def sel(side=None, **kw):
    m = np.ones(len(ann), bool)
    for k, v in kw.items():
        m &= ann[k].isin(v if isinstance(v, list) else [v]).values
    if side:
        m &= (ann.side == side).values
    return ids(m)


stims = {
    "sugar_L": sel("left", cell_sub_class="sugar/water"),
    "sugar_R": sel("right", cell_sub_class="sugar/water"),
    "bitter_L": sel("left", cell_sub_class="bitter"),
    "odor_L": sel("left", cell_type=[f"ORN_{g}" for g in FOOD_GLOMERULI]),
    "odor_R": sel("right", cell_type=[f"ORN_{g}" for g in FOOD_GLOMERULI]),
    "odor_both": sel(None, cell_type=[f"ORN_{g}" for g in FOOD_GLOMERULI]),
}

readouts = ["DNa01", "DNa02", "DNp09", "DNb05", "DNg14", "DNa03", "DNp42", "DNp01", "CB0701", "DNg11", "DNge001"]

if __name__ == "__main__":
    names = sys.argv[1:] or list(stims)
    res = {}
    for name in names:
        t0 = time.time()
        c = b.run(stims[name], t_ms=1000, seed=1)
        act = np.flatnonzero(c > 0)
        res[name] = {"counts": {int(b.ids[i]): int(c[i]) for i in act}}
        row = ann.set_index("root_id").reindex(b.ids[act])
        print(f"== {name}: n_stim={len(stims[name])} active={len(act)} ({time.time()-t0:.0f}s)")
        print("  by class:", row.cell_class.value_counts().head(12).to_dict())
        for ct in readouts:
            r = ann[ann.cell_type == ct]
            vals = [(s[0], int(c[b.index[int(x)]])) for x, s in zip(r.root_id, r.side.fillna("?")) if int(x) in b.index]
            if any(v for _, v in vals):
                print(f"  {ct}: {vals}")
        mb = row[row.cell_class.isin(["MBON", "DAN", "Kenyon_Cell"])]
        print("  MB:", mb.cell_class.value_counts().to_dict(), "DAN types:", mb[mb.cell_class == "DAN"].cell_type.value_counts().head(8).to_dict())
        dn = row[row.super_class == "descending"]
        print("  DNs active:", dn.cell_type.value_counts().head(15).to_dict())
    json.dump(res, open(os.path.join(DATA, "exp_" + "_".join(names) + ".json"), "w"))
