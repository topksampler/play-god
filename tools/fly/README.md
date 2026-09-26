# Fly circuit pipeline

Builds `public/fly/circuit.json` from FlyWire data. Needs Python 3 with `pandas pyarrow numpy scipy` (about 130 MB download and 2 GB RAM).

```bash
pip install pandas pyarrow numpy scipy
mkdir -p tools/fly/data && cd tools/fly/data
curl -LO https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Connectivity_783.parquet
curl -LO https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Completeness_783.csv
curl -LO https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
cd ../../..
python tools/fly/lif_full.py        # whole-brain check: sugar GRNs -> MN9 (~15 s per simulated second)
python tools/fly/signs.py           # writes data/w783_fixed.npz (sign-corrected weights)
python tools/fly/extract.py         # ~4 min; writes public/fly/circuit.json
npx tsx scripts/fly/calibrate.ts    # writes public/fly/calibration.json
npx tsx scripts/fly/smoke.ts        # JS vs Python fidelity + per-fly speed
```

`experiments.py` and `sweep.py` are the exploratory stimulus runs used to diagnose the transmitter-sign problem (see docs/FLY.md). `tools/fly/data/` is git-ignored.
