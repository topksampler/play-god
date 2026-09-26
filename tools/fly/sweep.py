import sys, time, numpy as np
from experiments import ann, b, sel
A = ann.set_index("root_id").reindex(b.ids)
def side_sum(c, mask):
    m = mask.values
    return int(c[m & (A.side == "left").values].sum()), int(c[m & (A.side == "right").values].sum())
dna02 = A.cell_type == "DNa02"; dna01 = A.cell_type == "DNa01"; pn = A.cell_class == "ALPN"; kc = A.cell_class == "Kenyon_Cell"
for glom in sys.argv[1].split(","):
    for rate in [float(r) for r in sys.argv[2].split(",")]:
        for side in ["left", "right"]:
            s = sel(side, cell_type=[f"ORN_{g}" for g in glom.split("+")])
            t0 = time.time(); c = b.run({tuple(s): rate}, t_ms=500, seed=2)
            print(f"{glom:12s} {side:5s} {rate:5.0f}Hz n={len(s):3d} active={int((c>0).sum()):5d} PN(L,R)={side_sum(c,pn)} KC={int((c[kc.values]>0).sum())} DNa02(L,R)={side_sum(c,dna02)} DNa01(L,R)={side_sum(c,dna01)} {time.time()-t0:.0f}s", flush=True)
