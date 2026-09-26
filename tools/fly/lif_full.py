"""Event-driven numpy reimplementation of the Shiu et al. 2024 whole-brain LIF model.

Equations and constants follow philshiu/Drosophila_brain_model model.py:
  dv/dt = (v_0 - v + g) / t_mbr ; dg/dt = -g / tau  (frozen while refractory)
  spike: v > v_th -> v = v_rst, g = 0 ; presynaptic spike adds w to post g after t_dly
  Poisson stimulus adds w_syn * f_poi directly to v, stimulated neurons have no refractory period.
"""
import os
import time
import numpy as np
import pandas as pd
import scipy.sparse as sp

DATA = os.path.join(os.path.dirname(__file__), "data")

P = dict(v_0=-52.0, v_rst=-52.0, v_th=-45.0, t_mbr=20.0, tau=5.0, t_rfc=2.2,
         t_dly=1.8, w_syn=0.275, r_poi=150.0, f_poi=250.0)


class Brain:
    def __init__(self, cache=True):
        comp = pd.read_csv(os.path.join(DATA, "Completeness_783.csv"), index_col=0)
        self.ids = comp.index.values
        self.index = {int(r): i for i, r in enumerate(self.ids)}
        self.n = len(self.ids)
        npz = os.path.join(DATA, "w783.npz")
        if cache and os.path.exists(npz):
            self.W = sp.load_npz(npz)
        else:
            con = pd.read_parquet(os.path.join(DATA, "Connectivity_783.parquet"))
            self.W = sp.csr_matrix(
                (con["Excitatory x Connectivity"].values.astype(np.float32) * P["w_syn"],
                 (con["Presynaptic_Index"].values, con["Postsynaptic_Index"].values)),
                shape=(self.n, self.n))
            sp.save_npz(npz, self.W)

    def idx(self, root_ids):
        return np.array([self.index[int(r)] for r in root_ids if int(r) in self.index], dtype=np.int64)

    def run(self, exc, t_ms=1000.0, dt=0.1, rate=None, silence=(), seed=0, W=None):
        """exc: dict {neuron_index_array: rate_hz} or array (uses P['r_poi']). Returns spike counts per neuron."""
        rng = np.random.default_rng(seed)
        W = self.W if W is None else W
        if len(silence):
            W = W.tolil(copy=True)
            for i in silence:
                W.rows[i] = []
                W.data[i] = []
            W = W.tocsr()
        if not isinstance(exc, dict):
            exc = {tuple(np.asarray(exc)): rate or P["r_poi"]}
        stim_idx = np.concatenate([np.asarray(k, dtype=np.int64) for k in exc])
        stim_rate = np.concatenate([np.full(len(k), r) for k, r in exc.items()])
        n = self.n
        v = np.full(n, P["v_0"], np.float32)
        g = np.zeros(n, np.float32)
        rfc_until = np.full(n, -1.0)
        no_rfc = np.zeros(n, bool)
        no_rfc[stim_idx] = True
        dly = int(round(P["t_dly"] / dt))
        ring = [np.zeros(n, np.float32) for _ in range(dly + 1)]
        counts = np.zeros(n, np.int32)
        self.first = np.full(n, np.inf)
        a_v = np.float32(np.exp(-dt / P["t_mbr"]))
        a_g = np.float32(np.exp(-dt / P["tau"]))
        # exact integration of the linear system for one step (alpha-like coupling)
        k = np.float32(P["tau"] * (np.exp(-dt / P["t_mbr"]) - np.exp(-dt / P["tau"])) / (P["t_mbr"] - P["tau"]))
        steps = int(t_ms / dt)
        for s in range(steps):
            t = s * dt
            active = rfc_until <= t
            slot = s % (dly + 1)
            g += ring[slot]
            ring[slot][:] = 0
            dv = v - P["v_0"]
            v_new = P["v_0"] + dv * a_v + g * k
            g_new = g * a_g
            v = np.where(active, v_new, v)
            g = np.where(active, g_new, g)
            fire = rng.random(len(stim_idx)) < stim_rate * dt * 1e-3
            v[stim_idx[fire]] += P["w_syn"] * P["f_poi"]
            spk = np.flatnonzero(v > P["v_th"])
            if spk.size:
                counts[spk] += 1
                self.first[spk] = np.minimum(self.first[spk], t)
                v[spk] = P["v_rst"]
                g[spk] = 0
                r = spk[~no_rfc[spk]]
                rfc_until[r] = t + P["t_rfc"]
                out = W[spk].sum(axis=0).A1
                ring[(s + dly) % (dly + 1)] += out
        return counts


if __name__ == "__main__":
    ann = pd.read_csv(os.path.join(DATA, "Supplemental_file1_neuron_annotations.tsv"), sep="\t", low_memory=False)
    t0 = time.time()
    b = Brain()
    print(f"loaded {b.n} neurons, {b.W.nnz} edges in {time.time()-t0:.1f}s")
    sugar = ann[(ann.cell_sub_class == "sugar/water") & (ann.cell_type == "LB3") & (ann.side == "left")].root_id
    mn9 = ann[ann.cell_type == "CB0701"].root_id.values
    si = b.idx(sugar)
    t0 = time.time()
    c = b.run(si, t_ms=1000)
    print(f"sugar stim ({len(si)} GRNs) 1s bio in {time.time()-t0:.1f}s; active neurons {np.sum(c>0)}")
    for r in mn9:
        print("MN9", r, "rate Hz", c[b.index[int(r)]])
