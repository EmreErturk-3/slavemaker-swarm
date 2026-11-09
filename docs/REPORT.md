# Slavemaker Swarm: an individual-based simulation of *Polyergus* slave raids on *Formica* colonies

**Project report, v0.2 (November 2026)**

---

## Abstract

Slavemaker Swarm is a live, individual-based 3-D simulation of **dulosis**, slave-making in ants. One
obligate slavemaker colony modelled on *Polyergus* shares a meadow with *Formica fusca*-group host
colonies, a non-host competitor modelled on *Lasius niger*, carcasses, seeds and aphid plants. Every
worker is an agent. Agents coordinate only through local sensing and five diffusing, evaporating
pheromone fields: two food-recruitment trails, a raid trail, a host alarm signal, and a slavemaker
Dufour's-gland secretion. The model follows the documented raid sequence step by step:

* scouts search for host nests and judge their size
* a successful scout returns laying a trail
* the colony musters and leaves in a column, in the late afternoon
* raiders enter the host nest, take one brood item each, and snatch brood from fleeing hosts
* the loot is reared at home and ecloses as *Formica* workers that forage, nurse and feed their captors

Hosts defend with alarm-recruited fighters and partial brood evacuation. Mated slavemaker queens found
colonies only by usurping a host nest. Enslaved workers can rebel by killing slavemaker pupae.
Colony-level traits are inherited through dispersing queens with mutation, so host defence and
parasite raid strategy coevolve with no explicit fitness function. This report covers the biology
behind each rule, the scaling choices, the implementation, the calibration problems we hit and fixed,
results from long headless runs, and the model's main limitations.

---

## 1. Aims

1. Reproduce, with locally sensing agents, the **behavioural sequence** of *Polyergus* raids and the
   **enslavement pipeline** (brood theft → eclosion → imprinted slave workforce) as described in field
   and laboratory studies.
2. Make **chemical communication** the coordination substrate, with one field per signal and rates
   that suit its function.
3. Include the documented **counter-strategies** on both sides: host defence and evacuation, scout
   target choice, Dufour's-gland appeasement, queen usurpation, and slave rebellion.
4. Put the strategic traits under **open-ended colony-level selection**, so the host–parasite arms
   race can be watched rather than assumed.
5. Make it **observable**: a 3-D meadow where an individual raider, slave or host can be followed and
   its history (for a slave, the nest it was stolen from) inspected.

## 2. Biological background

### 2.1 Dulosis

Slave-making has evolved several times independently, in the Formicinae (*Polyergus*, the
*Formica sanguinea* group) and the Myrmicinae (*Temnothorax* ex-*Protomognathus*, *Harpagoxenus*)
(Buschinger 2009; D'Ettorre & Heinze 2001). Facultative slavemakers such as *F. sanguinea* can live
without slaves. Obligate ones cannot. *Polyergus* workers have sickle-shaped mandibles that are
superb weapons but useless for digging, brood care or feeding. In mixed colonies, *Polyergus* workers
do little besides raiding, removing corpses and soliciting food from slaves by trophallaxis. The
enslaved *Formica* do the foraging, nest maintenance, brood and queen care (Hölldobler & Wilson 1990;
King & Trager 2007). Slaves even carry their masters during nest emigrations (Kwait & Topoff 1984).

### 2.2 The raid

| Feature | Field / laboratory observation | Source |
|---|---|---|
| Who starts it | One or a few scouts find a *Formica* nest, return laying a trail, and recruit | Topoff et al. 1984, 1987 |
| Recruitment signal | Chemical. Dufour's gland and hindgut involved. Recruitment is nearly absent outside raids and depends on host pupae | Topoff et al. 1984; Visicchio et al. 2001 |
| Time of day | Late afternoon, after the daily temperature peak. One colony raided at the same time each day | Talbot 1967; Topoff et al. 1984 |
| Frequency | 38 raids in 32 days (*P. breviceps*); often more than one raid a day (*P. lucidus*) | Topoff et al. 1987; Talbot 1967 |
| Pre-raid phase | Workers pour out and mill around their own nest in a frenzy before abruptly forming a column | Talbot 1967; Kwait & Topoff 1984 |
| Column | ~1–1.4 m per minute | Talbot 1967 |
| Distance | Scouting ranges of 25–45 m. Raids up to ~48 m | Topoff et al. 1987; Talbot 1967 |
| Size | Median 1,189–2,234 raiders per raid; up to 2,800 pupae in one day (*P. rufescens*) | Mori et al. 1991 |
| Duration | First loaded raiders return after ~29 min (14–45). Raids rarely exceed 1 h | Topoff et al. 1984 |
| Loot | One brood item per raider, usually a cocooned pupa, sometimes a larva. 98 raiders returned with 97 pupae in one raid | Talbot 1967 |
| Host defences | Kill the scout; fight; flee with brood and queen. Host species differ in aggression | Foitzik et al. 2001; Tamarri et al. 2009 |
| Target choice | Raiders assess target nests and prefer larger, better defended host colonies | Visicchio et al. 2003; Pohl & Foitzik 2011 |
| Colony composition | Laboratory *P. lucidus* colonies: 416 *Polyergus* with 2,502 *Formica*, and 385 with 1,500 (≈4–6 slaves per slavemaker) | Kwait & Topoff 1984 |

### 2.3 Chemical warfare

*Polyergus* raiders are largely immune to the formic acid that defends *Formica* nests. Several
slavemakers use Dufour's-gland secretions as weapons. In *Formica subintegra* raids, acetate
"propaganda substances" alarm and disperse defenders (Regnier & Wilson 1971). In *Harpagoxenus* and
*Protomognathus* they make defenders panic or attack one another (Allies, Bourke & Franks 1986). In
*Polyergus* the documented appeasement role belongs to the **queen**: her enlarged Dufour's gland,
dominated by decyl butyrate, sharply reduces worker aggression during usurpation (Mori et al. 2000;
Le Moli et al. 2000).

### 2.4 Usurpation

A mated *Polyergus* queen cannot found a colony alone. She enters a host nest, kills the resident
queen, and is adopted by the host workers. Chemicals acquired while killing the host queen (Topoff &
Zimmerli 1993) and her own Dufour's secretion (Mori et al. 2000) both contribute.

### 2.5 Slave rebellion

Enslaved *Temnothorax* workers kill up to about two-thirds of the female pupae of their slavemaker
(Achenbach & Foitzik 2009), recognising them chemically (Achenbach et al. 2010). Slaves never
reproduce, so the trait can only spread through benefits to related free-living colonies nearby. Its
persistence depends on spatial population structure and parameter regime (arXiv:1212.0790; Metzler
et al. 2016). This answered Gladstone's (1981) question of "why there are no ant slave rebellions".

### 2.6 The host and the competitor

*Formica fusca* colonies hold roughly 500–2,000 workers, often under stones. Workers forage singly,
scavenge small arthropods, and tend aphids for honeydew (AntWiki: *Formica fusca*). *Lasius niger*
tends aphids heavily, and its colonies are mutually aggressive (AntWiki: *Lasius niger*).

## 3. The model

### 3.1 World and time

* A 512 × 384 cell meadow (1 cell ≈ 2.5 cm, about 13 × 10 m).
* **Day/night cycle** of 4,800 ticks. *Formica* foraging drops to ~10 % at night, while *Lasius*
  stays partly active. **Raids may start only in the late-afternoon window** (tod 0.46–0.82).
  Scouting runs from late morning.
* **Food:** carcass and seed patches spawn at random and rot over time, so food doesn't pile up in
  unvisited corners. Scattered crumbs appear. 14 **aphid plants** drip honeydew around their stems
  as persistent, trail-forming sources.

### 3.2 Pheromone fields

Each signal is its own Float32 grid, updated every 2 ticks with a 5-point diffusion stencil and
multiplicative evaporation, restricted to each channel's active bounding box.

| Channel | Laid by | Read by | Evaporation / step | Diffusion |
|---|---|---|---|---|
| *Formica* trail | host foragers and slaves returning with food (strength decays with distance from the find) | host and slave foragers (3-sensor gradient steering, weight = *trail fidelity* gene) | 0.988 | 0.10 |
| *Lasius* trail | *Lasius* returning with food | *Lasius* only | 0.988 | 0.10 |
| Raid trail | a scout returning from a found host nest (strong); raiders (weak) | raiders: gradient steering restricted to sensors facing the target, so the non-polar trail is followed outward | 0.9975 | 0.015 |
| Alarm | host workers fighting, dying, or detecting raiders inside the nest | host colony (defender emergence and evacuation scale with alarm at the entrance); host foragers near home (recruited as defenders); defenders (climb the gradient) | 0.90 | 0.35 |
| Dufour's secretion | raiders within ~12 cells of the target; dose = the colony's *appeasement* gene | hosts: lower local attack probability; soaked defenders retreat; fewer defenders and more panic evacuation at the nest | 0.965 | 0.25 |

Homing uses **path integration**: heading to the known nest position with noise.

### 3.3 Agents

| State | Who | Behaviour |
|---|---|---|
| IN | everyone | inside the nest, not simulated spatially. Colony-level rates call workers out as foragers, scouts, raiders, defenders or evacuees |
| FORAGE | hosts, slaves, *Lasius* | correlated random walk plus trail and food gradient steering. Takes one food unit |
| RETURN | everyone | path integration home, laying food trail (or raid trail if a raider carries loot). On arrival: unload, and often head straight back out along the trail |
| SCOUT | *Polyergus* | outward-biased search up to the *raid range* gene. Assesses host nests: accepted with p ∝ min(1, workers/70) × min(1, brood/4) |
| SCOUT_BACK | *Polyergus* | returns laying a strong raid trail. Reports the target; the raid starts now if in the raid window, otherwise at the next window |
| RAID | *Polyergus* | **muster**: mill around own nest for 260 ticks; then **column**: follow the raid trail outward, releasing Dufour's secretion near the target; **assault**: take the most developed brood item (pupa, else late larva), or linger to fight and snatch brood from evacuees |
| DEFEND | free hosts | patrol around own nest climbing the alarm gradient. Retreat when soaked in Dufour's secretion |
| EVAC | free hosts | carry a pupa away from the nest, *opposite the raid's approach*, and return when the alarm clears. Evacuation is a capped trickle (∝ *flee* gene) |
| FIGHT | everyone | paired combat. *Polyergus* mandibles deal ~4× host damage, and *Polyergus* have ~2× host HP. Territorial skirmishes break off with p = 0.1 per tick; raid and nest-defence fights don't |
| GYNE | queens | dispersal flight to a free site (independent founding) or to a host nest (usurpation) |

Encounters use a uniform spatial hash. Attack probabilities depend on species, state, genes and local
Dufour's concentration. Raiders attack brood carriers with p = 0.9 and defenders of the target with
p = 0.5. Hosts attack slavemakers with p ∝ *aggression* × (1 − 0.6 × local Dufour), much more readily
when defending.

### 3.4 Colony life cycle and the enslavement pipeline

* **Queen.** Lays eggs scaled by food up to a colony cap. No senescence before 70,000 ticks, then a
  constant hazard. (A memoryless hazard killed the founding slavemaker queen early in one calibration
  run, see §5.)
* **Brood.** Egg to pupa in 1,800 ticks, pupa to adult in 1,200, developing only while nurses are
  present. Stolen brood keeps its age.
* **Enslavement.** A stolen *Formica* brood item matures in the slavemaker nest and ecloses as a
  *Formica* worker belonging to the slavemaker colony. It keeps its **natal genome** (aggression,
  rebellion, …), so it is identifiable in the inspector as "born in *Formica* #N".
* **Dependence.** A *Polyergus* queen lays at a rate × clamp((slaves/slavemakers − 1)/2.5, 0, 1).
  Slavemaker brood develops only with slaves in the nest. With no slaves, slavemakers starve even
  beside a full larder.
* **Raid trigger.** Scouts go out when slaves < *slave target* × slavemakers, or when the colony is
  hungry. One raid runs at a time. A productive target is remembered and raided again.
* **Usurpation.** p = clamp(0.15 + 0.7 × appeasement − 0.45 × host aggression × min(1, host workers/120),
  0.03, 0.95). On success the host queen dies, the colony switches to *Polyergus*, and all its workers
  and brood become slaves.
* **Rebellion.** When a slavemaker brood item pupates, it is killed with p = 0.7 × (mean rebellion of
  the colony's slaves). The cost: in free colonies, own pupae are misidentified with p = 0.08 × rebellion.

### 3.5 Evolution

Genomes are colony-level and inherited through gynes with Gaussian mutation (σ = 6 % of the trait
range by default).

| Species | Traits |
|---|---|
| *Formica* | aggression, brood evacuation, slave rebellion, search noise, trail fidelity, gyne investment |
| *Polyergus* | scouting effort, raid range, recruitment, Dufour appeasement (metabolic cost), slave target, gyne investment |
| *Lasius* | aggression, search noise, trail fidelity, gyne investment |

Short host dispersal (≤ 90 cells) creates spatial kin structure, which is the precondition for
rebellion to be favoured. Selection is entirely ecological. If a species dies out, an immigrant queen
can arrive (switchable).

### 3.6 Scaling

| Quantity | Field | Model | Factor |
|---|---|---|---|
| Host colony | 500–2,000 workers | 100–320 | ~1/5 |
| *Polyergus* colony | ~400 slavemakers + 1,500–2,500 slaves | 70 + 330 at start | ~1/6 |
| Raid size | ~1,000–2,000 raiders | 25–80 | ~1/30 |
| Raid distance | 25–48 m | 40–260 cells ≈ 1–6.5 m | ~1/8 |
| Raids per day | ≈ 1, sometimes more | ≈ 1 in the afternoon window | ≈ 1 |
| Slaves per slavemaker | ≈ 4–6 | 4.7 at start; 4.5 default target (evolvable) | ≈ 1 |

Distances and absolute sizes are scaled down to fit a browser. Ratios and the order of events are
kept close to field values.

## 4. Implementation

| Aspect | Choice |
|---|---|
| Stack | Plain JavaScript and WebGL2, no build and no dependencies. Classic scripts so `index.html` runs from `file://` |
| Agents | Struct-of-arrays typed arrays with a free list (capacity 30,000) and per-ant unique ids. Uniform spatial hash for encounters |
| Pheromones | Five planar Float32 fields, ping-pong buffers, updated only inside each channel's active bounding box |
| Determinism | Seeded mulberry32 PRNG. The renderer's terrain noise is separate, so visuals never change the simulation |
| 3-D view | Height-mapped meadow with procedural grass texture, instanced voxel boxes for ants (gaster, petiole, two-part mesosoma, head, six legs with tripod gait, antennae, *Polyergus* sickle mandibles), mounds, *Formica* nest stones, food, aphid plants, grass tufts and pebbles. Sun/sky/fog follow the day cycle. Ground-shader decals for colony rings, alarm pulses and slave-eclosion flashes. Optional pheromone overlay from R16F textures |
| Cameras | Orbit; free-fly; ride-an-ant chase-cam and ant-eye view. Click any ant to ride it; the ID card shows colony, task, cargo, target and, for slaves, natal colony and genes. Follow-raid tracks the column's centroid |
| Charts | Population lines; trait small multiples (colony mean with min–max band) |
| Testing | `tools/headless.html` runs the DOM-free core and posts a summary to `tools/server.py`. A `?snap=1` hook exports a rendered frame |

## 5. Calibration log

Each of these was found in headless runs and fixed. They are listed because they are general traps
in stigmergic and host–parasite models.

1. **Non-polar trail trap.** Raiders steering purely up the raid-trail gradient circled near home,
   where the trail is strongest. Fix: sense only toward the target. Before this, raids never ended.
2. **Fight-resets-timer livelock.** Resuming after a fight reset the raider's timeout, so raiders in
   endless skirmishes at the host nest never came home and blocked all later raids. Fix: separate fight timer.
3. **Unreachable food.** Fractional food amounts smaller than a carryable unit accumulated until the
   global food cap stopped new patches. Fix: whole food units.
4. **Food piling up in unvisited corners** caused a slow starvation of all species over ~100,000
   ticks. Fix: carcasses rot.
5. **Skirmish attrition.** Ordinary encounters at shared food were lethal and dominated mortality.
   Fix: territorial fights usually break off.
6. **Instant evacuation.** Hosts emptied their nest of pupae within ~20 ticks of the alarm, so raids
   came home with almost nothing. Fix: a capped trickle, matching "save a fraction of the brood".
7. **Raiding tiny colonies.** Scouts targeted newly founded nests with no brood, killing their queens
   and returning empty. Fix: scouts assess size and brood (Pohl & Foitzik 2011).
8. **Too-short worker lives.** With ~5-day lifespans and ~1 raid a day, raids could not replace
   slaves. Fix: ~12–15-day lifespans.
9. **Memoryless queen death** ended the founding slavemaker lineage at day 2 in one run. Fix: no
   senescence before a minimum age.

## 6. Results

Two headless runs of the final model, 60,000 ticks each (12.5 simulated days), default settings
(14 *Formica*, 3 *Lasius*, 1 *Polyergus* colony at the start), seeds 2 and 3. Values are read every
6,000 (seed 2) or 10,000 (seed 3) ticks.

**Seed 2: a persisting parasite.**

| Day | Free *Formica* | Slaves | *Polyergus* | *Polyergus* colonies | Raids (cum.) | Brood stolen (cum.) | Usurpations (ok/attempts) |
|---|---|---|---|---|---|---|---|
| 1.25 | 2,625 | 288 | 100 | 1 | 1 | 29 | 0/1 |
| 3.75 | 3,387 | 227 | 120 | 1 | 4 | 40 | 0/1 |
| 6.25 | 3,341 | 166 | 96 | 1 | 6 | 66 | 0/2 |
| 8.75 | 3,327 | 163 | 105 | 1 | 9 | 100 | 0/4 |
| 12.5 | 3,226 | 218 | 119 | 3 | 13 | 131 | 2/8 |

**Seed 3: a parasite invasion.**

| Day | Free *Formica* | Slaves | *Polyergus* | *Polyergus* colonies | Raids (cum.) | Brood stolen (cum.) | Usurpations (ok/attempts) |
|---|---|---|---|---|---|---|---|
| 2.1 | 2,857 | 339 | 143 | 1 | 3 | 88 | 0/2 |
| 4.2 | 2,834 | 349 | 135 | 1 | 5 | 149 | 0/3 |
| 6.25 | 3,078 | 327 | 147 | 2 | 7 | 155 | 1/5 |
| 10.4 | 2,997 | 517 | 261 | 3 | 17 | 215 | 2/11 |
| 12.5 | 2,356 | 924 | 413 | 7 | 28 | 310 | 6/17 |

**Observations.**

1. **Raid cadence matches the field.** The founding colony raided about once per simulated day (13
   raids in 12.5 days in seed 2), always in the late-afternoon window, against Topoff et al.'s 38 raids
   in 32 days. Colonies remembered productive targets and raided them again on later days.
2. **The full enslavement pipeline runs.** Brood carried home matured and eclosed as tagged slaves
   (visible as eclosion flashes on the nest ring). Slaves took over foraging, and their trails linked
   the slavemaker nest to food. Without slaves, *Polyergus* egg-laying stops by construction.
3. **Usurpation is the bottleneck for spread.** Success rates were 25–35 % (2/8, 6/17). Failures came
   from queens meeting large, aggressive host colonies. Successful takeovers converted 28–300 host
   workers into slaves at once. One usurpation is worth many raids, which is why the colony count
   jumps in seed 3.
4. **Two regimes from the same parameters.** In seed 2 the parasite persisted at roughly constant
   size while hosts stayed near their food-limited ceiling. In seed 3 three successful usurpations in
   quick succession started a positive feedback: more slavemaker colonies, more raids, more slaves.
   Free *Formica* fell by about 21 % (2,997 → 2,356) over the last two days. Whether this ends in a crash (parasite
   overexploitation) or a new equilibrium needs longer runs.
5. **Rebellion costs the parasite something.** Slaves killed 14 (seed 2) and 21 (seed 3) slavemaker
   pupae at the default trait values (mean rebellion ≈ 0.04–0.06). Over this horizon there was no
   detectable trend in the rebellion trait, as expected: kin-selected traits change slowly, and maximum
   colony generation was only 2.
6. **Deviations from field values.** Raid yields were 0–34 brood items for 25–80 raiders, below the
   field's roughly one item per raider. The slave:slavemaker ratio drifted to 1.2–2.9, below the 4–6
   of laboratory colonies. Host nests in the model hold less brood relative to raid size than real
   *F. fusca* nests, and partial evacuation removes some of it.
7. **Evolution needs longer runs.** In 12.5 days most colonies are first-generation, and trait means
   moved only by drift (e.g. *slave target* 3.49 → 3.81 in seed 2 as new slavemaker lineages were
   founded). Directional coevolution has to be studied with turbo-speed or headless runs of 10⁶ ticks
   and many seeds (§8).

**Performance.** With ~4,000 ants the simulation costs ≈2.8 ms per tick in Firefox, so 4× speed uses
≈11 ms of each frame. Building the instanced scene costs ≈0.2–0.5 ms per frame on the CPU. Moving
the colony-ring decals from a per-pixel loop over all nests to a 16-cell lookup grid cut the GPU
frame time by more than half in our test environment.

## 7. Limitations and modelling liberties

* **Raiders releasing appeasing Dufour's secretion** merges three documented findings: *Polyergus*
  queen appeasement, *Polyergus* worker recruitment via the same gland, and propaganda in other
  slavemakers. For *Polyergus* raiding workers it is a hypothesis, not an observation.
* **Slave rebellion** is documented in *Temnothorax* hosts, not (to our knowledge) in *Formica* hosts
  of *Polyergus*. It is included as a switchable trait to explore the kin-selection question here.
* Recognition is colony membership plus natal genome, with no explicit cuticular-hydrocarbon chemistry.
  Nests have no interior structure. There is no seasonality, nest relocation, emigration raid,
  polydomy, or male production.
* Absolute sizes and distances are scaled down (§3.6). Rates are calibrated qualitatively, not fitted
  to data.
* Colony-level genomes ignore within-colony genetic variation and queen number.

## 8. Future work

* **Explicit chemical recognition:** colony odour vectors that drift and mix, enabling chemical
  mimicry, imprinting and rebellion-by-recognition (Achenbach et al. 2010).
* **Season and relocation:** a raiding season with induced host aggression (Pamminger et al. 2011),
  and slavemaker nest relocation toward host-rich areas.
* **Emigration raids**, in which slaves carry *Polyergus* to a new nest (Kwait & Topoff 1984).
* **Alternative systems:** a *Temnothorax americanus* parameter set (small colonies, larval theft,
  stinging raiders, documented rebellion) and a facultative *F. sanguinea* mode.
* **Quantitative experiments:** many-seed headless sweeps on host persistence vs dispersal distance
  (the kin-selection explanation of rebellion), raid yield vs target size, and cycling of host
  aggression against slavemaker appeasement.
* **Scale:** moving the field update and movement to WebGPU compute to approach real raid sizes.

## 9. Related work: ant simulation

* **Stigmergy and trails.** Grassé (1959); Theraulaz & Bonabeau (1999). Deneubourg et al. (1990)
  showed how trail laying and following yields the Argentine ant's exploratory pattern, and Goss et
  al. (1989) showed how it finds shortcuts.
* **Agent-based ant models.** Resnick (1994) introduced StarLogo, and the NetLogo *Ants* model
  (Wilensky 1997) is the canonical pheromone forager. Our forager descends from it. Three-sensor
  gradient steering follows the *Physarum* agent model of Jones (2010).
* **Swarm intelligence in social insects.** Bonabeau, Dorigo & Theraulaz (1999); Garnier, Gautrais &
  Theraulaz (2007).
* **Slavemaker–host models.** Spatial and kin-selection models of slave rebellion (arXiv:1212.0790;
  Metzler et al. 2016) work at population or metapopulation level. We found no openly available
  *individual-based, pheromone-explicit* dulosis model with raid behaviour at the level of single
  workers, which is what this project provides.

## References

### Slave-making ants, hosts, and their biology

* Achenbach, A. & Foitzik, S. (2009). First evidence for slave rebellion: enslaved ant workers systematically kill the brood of their social parasite *Protomognathus americanus*. *Evolution* 63(4), 1068–1075. https://doi.org/10.1111/j.1558-5646.2009.00591.x
* Achenbach, A., Witte, V. & Foitzik, S. (2010). Brood exchange experiments and chemical analyses shed light on slave rebellion in ants. *Behavioral Ecology* 21(5), 948–956. https://academic.oup.com/beheco/article-abstract/21/5/948/196866
* Allies, A. B., Bourke, A. F. G. & Franks, N. R. (1986). Propaganda substances in the cuckoo ant *Leptothorax kutteri* and the slave-maker *Harpagoxenus sublaevis*. *Journal of Chemical Ecology* 12, 1285–1293.
* AntWiki. *Formica fusca*. https://www.antwiki.org/wiki/Formica_fusca · *Lasius niger*. https://antwiki.org/wiki/Lasius_niger
* Buschinger, A. (2009). Social parasitism among ants: a review. *Myrmecological News* 12, 219–235.
* D'Ettorre, P. & Heinze, J. (2001). Sociobiology of slave-making ants. *Acta Ethologica* 3, 67–82.
* Foitzik, S., DeHeer, C. J., Hunjan, D. N. & Herbers, J. M. (2001). Coevolution in host–parasite systems: behavioural strategies of slave-making ants and their hosts. *Proceedings of the Royal Society B* 268, 1139–1146. https://www.researchgate.net/publication/11963532
* Gladstone, D. E. (1981). Why there are no ant slave rebellions. *The American Naturalist* 117, 779–781.
* Hölldobler, B. & Wilson, E. O. (1990). *The Ants*. Belknap Press. Ch. 12, Social parasitism. https://www.antwiki.org/wiki/The_Ants_Chapter_12
* King, J. R. & Trager, J. C. (2007). Natural history of the slave making ant, *Polyergus lucidus*, sensu lato in northern Florida and its three *Formica pallidefulva* group hosts. *Journal of Insect Science* 7(42). https://academic.oup.com/jinsectscience/article/7/1/42/871130
* Kwait, E. C. & Topoff, H. (1984). Raid organization and behavioral development in the slave-making ant *Polyergus lucidus*. *Insectes Sociaux* 31, 361–374. https://www.antwiki.org/w/images/e/eb/Cool-Kwait,_C.,_Topoff,_H._1984._Raid_organization_and_behavioral_development_(10.1007@BF02223653).pdf
* Le Moli, F., Visicchio, R., Mori, A. et al. (2000). Decyl butyrate as the main ester of queen Dufour's gland secretion in *Polyergus rufescens*: an appeasement allomone. *Ethology Ecology & Evolution* 12, 315–322.
* Metzler, D., Jordan, F., Pamminger, T. & Foitzik, S. (2016). The influence of space and time on the evolution of altruistic defence: the case of ant slave rebellion. *Journal of Evolutionary Biology* 29, 874–886. https://doi.org/10.1111/jeb.12846
* Mori, A., Grasso, D. A. & Le Moli, F. (1991). Eco-ethological factors affecting the scouting and raiding behaviour of the slave-making ant *Polyergus rufescens*. *Ethology* 88, 46–62. https://www.researchgate.net/publication/249440274
* Mori, A., Grasso, D. A. & Le Moli, F. (2000). Raiding and foraging behavior of the blood-red ant, *Formica sanguinea*. *Journal of Insect Behavior* 13, 421–438.
* Mori, A., Grasso, D. A., Visicchio, R. & Le Moli, F. (2000). Colony founding in *Polyergus rufescens*: the role of the Dufour's gland. *Insectes Sociaux* 47, 7–10. https://link.springer.com/article/10.1007/s000400050002
* Visicchio, R., Castracani, C., Mori, A., Grasso, D. A. & Le Moli, F. (2003). How raiders of the slave-making ant *Polyergus rufescens* evaluate a target host nest. *Ethology Ecology & Evolution* 15, 369–378. https://doi.org/10.1080/08927014.2003.9522663
* Pamminger, T., Scharf, I., Pennings, P. S. & Foitzik, S. (2011). Increased host aggression as an induced defense against slave-making ants. *Behavioral Ecology* 22(2), 255–260. https://academic.oup.com/beheco/article/22/2/255/207141
* Pohl, S. & Foitzik, S. (2011). Slave-making ants prefer larger, better defended host colonies. *Animal Behaviour* 81, 61–68. https://www.sciencedirect.com/science/article/abs/pii/S0003347210003441
* Regnier, F. E. & Wilson, E. O. (1971). Chemical communication and "propaganda" in slave-maker ants. *Science* 172, 267–269.
* Talbot, M. (1967). Slave-raids of the ant *Polyergus lucidus* Mayr. *Psyche* 74, 299–313. http://psyche.entclub.org/74/74-299.html
* Tamarri, V., Castracani, C., Grasso, D. A., Visicchio, R., Le Moli, F. & Mori, A. (2009). The defensive behaviour of two *Formica* slave-ant species: coevolutive implications with their parasite *Polyergus rufescens*. *Italian Journal of Zoology* 76, 229–238. https://doi.org/10.1080/11250000802256002
* Topoff, H., LaMon, B., Goodloe, L. & Goldstein, M. (1984). Social and orientation behavior of *Polyergus breviceps* during slave-making raids. *Behavioral Ecology and Sociobiology* 15, 273–279.
* Topoff, H., Bodoni, D., Sherman, P. & Goodloe, L. (1987). The role of scouting in slave raids by *Polyergus breviceps*. *Psyche* 94, 261–270. http://psyche.entclub.org/94/94-261.html
* Topoff, H. & Zimmerli, E. (1993). Colony takeover by a socially parasitic ant, *Polyergus breviceps*: the role of chemicals obtained during host-queen killing. *Animal Behaviour* 46, 479–486.
* Visicchio, R., Mori, A., Grasso, D. A., Castracani, C. & Le Moli, F. (2001). Glandular sources of recruitment, trail, and propaganda semiochemicals in the slave-making ant *Polyergus rufescens*. *Ethology Ecology & Evolution* 13, 361–372. https://doi.org/10.1080/08927014.2001.9522767
* Anonymous preprint (2012). Oh sister, where art thou? Spatial population structure and the evolution of an altruistic defence trait. arXiv:1212.0790. https://arxiv.org/pdf/1212.0790

### Ant simulation and swarm intelligence

* Bonabeau, E., Dorigo, M. & Theraulaz, G. (1999). *Swarm Intelligence: From Natural to Artificial Systems*. Oxford University Press.
* Deneubourg, J.-L., Aron, S., Goss, S. & Pasteels, J. M. (1990). The self-organizing exploratory pattern of the Argentine ant. *Journal of Insect Behavior* 3, 159–168.
* Garnier, S., Gautrais, J. & Theraulaz, G. (2007). The biological principles of swarm intelligence. *Swarm Intelligence* 1, 3–31.
* Goss, S., Aron, S., Deneubourg, J.-L. & Pasteels, J. M. (1989). Self-organized shortcuts in the Argentine ant. *Naturwissenschaften* 76, 579–581.
* Grassé, P.-P. (1959). La reconstruction du nid et les coordinations interindividuelles chez *Bellicositermes natalensis* et *Cubitermes* sp. *Insectes Sociaux* 6, 41–80.
* Jones, J. (2010). Characteristics of pattern formation and evolution in approximations of *Physarum* transport networks. *Artificial Life* 16(2), 127–153.
* Resnick, M. (1994). *Turtles, Termites, and Traffic Jams*. MIT Press.
* Theraulaz, G. & Bonabeau, E. (1999). A brief history of stigmergy. *Artificial Life* 5(2), 97–116.
* Wehner, R. (2003). Desert ant navigation: how miniature brains solve complex tasks. *Journal of Comparative Physiology A* 189, 579–588.
* Wilensky, U. (1997). NetLogo Ants model. Northwestern University. http://ccl.northwestern.edu/netlogo/models/Ants

### Evolution

* Dawkins, R. & Krebs, J. R. (1979). Arms races between and within species. *Proceedings of the Royal Society B* 205, 489–511.
* Hamilton, W. D. (1964). The genetical evolution of social behaviour I & II. *Journal of Theoretical Biology* 7, 1–52.
