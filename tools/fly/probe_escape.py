"""Probe: do looming-detector (LC4/LPLC2) and auditory (JO-A/B) inputs drive the Giant Fiber (DNp01)?"""
import os, time
import numpy as np, pandas as pd, scipy.sparse as sp
from lif_full import Brain, DATA

ann = pd.read_csv(os.path.join(DATA, "Supplemental_file1_neuron_annotations.tsv"), sep="\t", low_memory=False)
b = Brain()
W = sp.load_npz(os.path.join(DATA, "w783_fixed.npz"))
A = ann.set_index("root_id").reindex(b.ids)
ct = A.cell_type.fillna("").astype(str).values
sub = A.cell_sub_class.fillna("").values
side = A.side.fillna("").values
def g(mask, s=None):
    m = mask.copy()
    if s: m &= side == s
    return np.flatnonzero(m)
loom = np.isin(ct, ["LC4", "LPLC2"])
aud = (sub == "auditory") & pd.Series(ct).str.match(r"JO-[AB]").values
GF = {"L": g(ct == "DNp01", "left"), "R": g(ct == "DNp01", "right")}
print("loom L/R", len(g(loom, "left")), len(g(loom, "right")), "aud L/R", len(g(aud, "left")), len(g(aud, "right")), "GF", GF)
for name, stim in [
    ("loomL100", {tuple(g(loom, "left")): 100.0}),
    ("loomL200", {tuple(g(loom, "left")): 200.0}),
    ("loomR200", {tuple(g(loom, "right")): 200.0}),
    ("loomLR200", {tuple(np.flatnonzero(loom)): 200.0}),
    ("aud150", {tuple(np.flatnonzero(aud)): 150.0}),
]:
    t0 = time.time()
    c = b.run(stim, t_ms=500, seed=1, W=W)
    print(name, "active", int((c > 0).sum()), "GF_L Hz", c[GF["L"]].sum() * 2, "GF_R Hz", c[GF["R"]].sum() * 2, f"{time.time()-t0:.0f}s", flush=True)
