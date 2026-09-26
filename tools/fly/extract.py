"""Activity-pruned circuit extraction.

Runs the sign-corrected whole-brain LIF under every stimulus the habitat can deliver, keeps each neuron
that spikes in any condition plus the readout/learning neurons, and exports that subgraph for the browser.
Neurons silent in every condition contribute nothing to those conditions, so the pruned circuit reproduces
the whole brain for tested stimuli; untested combinations are an approximation.
"""
import json
import os
import time
import numpy as np
import pandas as pd
import scipy.sparse as sp
from lif_full import Brain, DATA, P

ann = pd.read_csv(os.path.join(DATA, "Supplemental_file1_neuron_annotations.tsv"), sep="\t", low_memory=False)
ann["cell_type"] = ann.cell_type.fillna("")
b = Brain()
W = sp.load_npz(os.path.join(DATA, "w783_fixed.npz"))
A = ann.set_index("root_id").reindex(b.ids)
A["cell_type"] = A.cell_type.fillna("")
AUDITORY = (A.cell_sub_class == "auditory").values & A.cell_type.str.match(r"JO-[AB]").values

ODOR_A = ["DM1", "DM4", "DP1m", "VA2", "DM2", "VM2"]
ODOR_B = ["DA3", "DC1", "DL1", "VA6", "VM3"]


def grp(side=None, mask=None, **kw):
    m = np.ones(len(A), bool) if mask is None else mask.copy()
    for k, v in kw.items():
        m &= A[k].isin(v if isinstance(v, list) else [v]).values
    if side:
        m &= (A.side == side).values
    return np.flatnonzero(m)


INPUTS = {
    "odorA_L": grp("left", cell_type=[f"ORN_{g}" for g in ODOR_A]),
    "odorA_R": grp("right", cell_type=[f"ORN_{g}" for g in ODOR_A]),
    "odorB_L": grp("left", cell_type=[f"ORN_{g}" for g in ODOR_B]),
    "odorB_R": grp("right", cell_type=[f"ORN_{g}" for g in ODOR_B]),
    "sugar_L": grp("left", cell_sub_class="sugar/water"),
    "sugar_R": grp("right", cell_sub_class="sugar/water"),
    "bitter_L": grp("left", cell_sub_class="bitter"),
    "bitter_R": grp("right", cell_sub_class="bitter"),
    # Looming detectors of each optic lobe (von Reyn et al. 2017; Ache et al. 2019) and Johnston's organ auditory neurons.
    "lc4_L": grp("left", cell_type="LC4"), "lc4_R": grp("right", cell_type="LC4"),
    "lplc2_L": grp("left", cell_type="LPLC2"), "lplc2_R": grp("right", cell_type="LPLC2"),
    "aud_L": grp("left", mask=AUDITORY), "aud_R": grp("right", mask=AUDITORY),
}
OUTPUTS = {
    "DNa02_L": grp("left", cell_type="DNa02"), "DNa02_R": grp("right", cell_type="DNa02"),
    "DNa01_L": grp("left", cell_type="DNa01"), "DNa01_R": grp("right", cell_type="DNa01"),
    "DNp09_L": grp("left", cell_type="DNp09"), "DNp09_R": grp("right", cell_type="DNp09"),
    "MN9": grp(None, cell_type="CB0701"),
    # Giant Fiber descending neurons: a spike commands the escape takeoff (von Reyn et al. 2014).
    "GF_L": grp("left", cell_type="DNp01"), "GF_R": grp("right", cell_type="DNp01"),
}
MB = {
    "PAM": grp(None, cell_class="DAN", cell_type=[t for t in A.cell_type.unique() if t.startswith("PAM")]),
    "PPL1": grp(None, cell_class="DAN", cell_type=[t for t in A.cell_type.unique() if t.startswith("PPL1")]),
    "MBON": grp(None, cell_class="MBON"),
}

CONDITIONS = []
for r in (40.0, 150.0):
    for s in ("L", "R"):
        CONDITIONS += [{f"odorA_{s}": r}, {f"odorB_{s}": r}, {f"odorA_{s}": r, f"sugar_{s}": 150.0},
                       {f"odorB_{s}": r, f"bitter_{s}": 150.0}]
CONDITIONS += [{"odorA_L": 150.0, "odorA_R": 150.0}, {"odorB_L": 150.0, "odorB_R": 150.0},
               {"sugar_L": 150.0, "sugar_R": 150.0}, {"bitter_L": 150.0, "bitter_R": 150.0},
               {"odorA_L": 150.0, "odorA_R": 60.0}, {"odorA_L": 60.0, "odorA_R": 150.0}]
for r in (30.0, 80.0, 200.0):
    for s in ("L", "R"):
        CONDITIONS.append({f"lc4_{s}": r, f"lplc2_{s}": r})
CONDITIONS += [{"lc4_L": 200.0, "lplc2_L": 200.0, "lc4_R": 200.0, "lplc2_R": 200.0},
               {"aud_L": 60.0, "aud_R": 60.0}, {"aud_L": 150.0, "aud_R": 150.0}, {"aud_L": 150.0}, {"aud_R": 150.0},
               {"lc4_L": 200.0, "lplc2_L": 200.0, "odorA_L": 150.0, "odorA_R": 150.0},
               {"aud_L": 150.0, "aud_R": 150.0, "odorA_L": 150.0, "odorA_R": 150.0}]

if __name__ == "__main__":
    active = np.zeros(b.n, bool)
    ref = []
    for i, cond in enumerate(CONDITIONS):
        t0 = time.time()
        stim = {tuple(INPUTS[k]): r for k, r in cond.items()}
        c = b.run(stim, t_ms=500, seed=10 + i, W=W)
        active |= c > 0
        ref.append({"cond": cond, "out": {k: float(c[v].sum()) * 2.0 for k, v in OUTPUTS.items()}, "n_active": int((c > 0).sum())})
        print(i, cond, ref[-1]["n_active"], {k: round(v) for k, v in ref[-1]["out"].items()}, f"{time.time()-t0:.0f}s", flush=True)
    keep = active.copy()
    for d in (INPUTS, OUTPUTS, MB):
        for v in d.values():
            keep[v] = True
    idx = np.flatnonzero(keep)
    remap = -np.ones(b.n, np.int64)
    remap[idx] = np.arange(len(idx))
    sub = W[idx][:, idx].tocoo()
    print("kept neurons", len(idx), "edges", sub.nnz)
    kc = (A.cell_class.values[idx] == "Kenyon_Cell")
    mbon = (A.cell_class.values[idx] == "MBON")
    plastic = kc[sub.row] & mbon[sub.col]
    from signs import transmitter_table
    nt = transmitter_table(ann).set_axis(ann.root_id).reindex(b.ids[idx]).fillna("").values
    con = pd.read_parquet(os.path.join(DATA, "Connectivity_783.parquet"))
    dan_set = set(MB["PAM"].tolist() + MB["PPL1"].tolist())
    mbon_set = set(MB["MBON"].tolist())
    dm = con[con.Presynaptic_Index.isin(dan_set) & con.Postsynaptic_Index.isin(mbon_set)]
    dm = dm.groupby(["Presynaptic_Index", "Postsynaptic_Index"]).Connectivity.sum().reset_index()
    dan_to_mbon = [{"dan": int(remap[r.Presynaptic_Index]), "mbon": int(remap[r.Postsynaptic_Index]), "count": int(r.Connectivity)} for r in dm.itertuples()]
    mbon_sign = {str(int(remap[m])): (1 if nt[remap[m]] == "acetylcholine" else -1 if nt[remap[m]] == "glutamate" else 0) for m in MB["MBON"]}
    print("DAN->MBON links", len(dan_to_mbon), "MBON signs", pd.Series(list(mbon_sign.values())).value_counts().to_dict())
    circuit = {
        "source": "FlyWire FAFB v783 (Dorkenwald et al. 2024; Schlegel et al. 2024) via Shiu et al. 2024 connectivity; sign-corrected, activity-pruned",
        "params": P,
        "n": int(len(idx)),
        "rootIds": [str(int(x)) for x in b.ids[idx]],
        "cellType": [str(x) for x in A.cell_type.values[idx]],
        "cellClass": [str(x) if isinstance(x, str) else "" for x in A.cell_class.values[idx]],
        "side": [str(x)[0] if isinstance(x, str) else "?" for x in A.side.values[idx]],
        "pre": sub.row.tolist(), "post": sub.col.tolist(), "w": [round(float(x), 4) for x in sub.data],
        "plastic": np.flatnonzero(plastic).tolist(),
        "inputs": {k: remap[v].tolist() for k, v in INPUTS.items()},
        "outputs": {k: remap[v].tolist() for k, v in OUTPUTS.items()},
        "mb": {k: remap[v].tolist() for k, v in MB.items()},
        "danToMbon": dan_to_mbon,
        "mbonSign": mbon_sign,
        "reference": ref,
    }
    out = os.path.join(os.path.dirname(__file__), "..", "..", "public", "fly", "circuit.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(circuit, open(out, "w"), separators=(",", ":"))
    print("wrote", os.path.abspath(out), os.path.getsize(out) // 1024, "KB; plastic KC->MBON edges", int(plastic.sum()))
