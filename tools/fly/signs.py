"""Synapse sign corrections on top of the Shiu et al. FlyWire v783 connectivity.

Shiu et al. treat acetylcholine, dopamine, serotonin and octopamine as excitatory and GABA/glutamate as
inhibitory, using machine-predicted transmitters. With those signs, one DM1 ORN at 30 Hz ignites ~10K
neurons, driven by AL local neurons predicted as serotonin/dopamine firing at ~250 Hz.

Rules applied here, in priority order:
  1. Literature transmitter (`known_nt`, first recognised token) overrides prediction.
  2. Kenyon cells are cholinergic (Barnstedt et al. 2016); sensory neurons predicted monoaminergic are cholinergic.
  3. AL local neurons predicted monoaminergic are GABAergic (most AL LNs are GABAergic).
  4. Remaining monoaminergic synapses (dopamine, serotonin, octopamine) are neuromodulatory, so they get
     zero fast weight. Dopamine acts only through the mushroom-body plasticity rule.
  5. Sensory-to-sensory (axo-axonic) edges are removed.
"""
import os
import numpy as np
import pandas as pd
import scipy.sparse as sp
from lif_full import DATA, P

FAST = {"acetylcholine": 1.0, "gaba": -1.0, "glutamate": -1.0, "histamine": -1.0}
MONO = {"dopamine", "serotonin", "octopamine"}


def transmitter_table(ann):
    nt = ann.top_nt.fillna("acetylcholine").str.lower().copy()
    known = ann.known_nt.fillna("").str.lower().str.split(r"[;,]").str[0].str.strip()
    lit = known.isin(list(FAST) + list(MONO))
    nt[lit] = known[lit]
    mono = nt.isin(MONO) & ~lit
    nt[(ann.cell_class == "Kenyon_Cell").values & ~lit] = "acetylcholine"
    sensory = ann.super_class.isin(["sensory", "sensory_ascending"])
    nt[mono & sensory] = "acetylcholine"
    nt[mono & (ann.cell_class == "ALLN")] = "gaba"
    return nt


def build(ann, out="w783_fixed.npz"):
    comp = pd.read_csv(os.path.join(DATA, "Completeness_783.csv"), index_col=0)
    nt = transmitter_table(ann).set_axis(ann.root_id).reindex(comp.index).fillna("acetylcholine")
    sign = nt.map(lambda t: FAST.get(t, 0.0)).values.astype(np.float32)
    sens = ann.set_index("root_id").super_class.reindex(comp.index).isin(["sensory"]).values
    con = pd.read_parquet(os.path.join(DATA, "Connectivity_783.parquet"))
    pre, post = con.Presynaptic_Index.values, con.Postsynaptic_Index.values
    w = con.Connectivity.values.astype(np.float32) * sign[pre] * P["w_syn"]
    keep = (w != 0) & ~(sens[pre] & sens[post])
    W = sp.csr_matrix((w[keep], (pre[keep], post[keep])), shape=(len(comp), len(comp)))
    sp.save_npz(os.path.join(DATA, out), W)
    summary = nt.value_counts().to_dict()
    return W, summary, int((~keep).sum())


if __name__ == "__main__":
    ann = pd.read_csv(os.path.join(DATA, "Supplemental_file1_neuron_annotations.tsv"), sep="\t", low_memory=False)
    W, summary, dropped = build(ann)
    print("transmitters:", summary)
    print("edges kept", W.nnz, "dropped", dropped)
