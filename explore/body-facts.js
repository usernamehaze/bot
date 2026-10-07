/* What a part of the body is, and what it does — short, plain and true, for the sheet that
   opens when a part is tapped. Matched by the part's official name (Terminologia Anatomica id,
   e.g. "left_ventricle", "biceps_brachii_muscle_l"). Parts not here are explained by Cassie. */

// [pattern on the id, what it is, what it does]
const FACTS = [
  // ---------- circulatory ----------
  [/^heart$/, 'A muscular pump about the size of your fist, in the middle of the chest, tipped to the left.', 'It beats about 100,000 times a day, pushing blood through two loops: to the lungs to pick up oxygen, and to the whole body to deliver it.', { layer: 'cardiovascular' }],
  [/^left_ventricle/, 'The heart’s strongest chamber, at the lower left.', 'It squeezes oxygen-rich blood into the aorta and out to the whole body — that’s why its wall is the thickest.', { layer: 'cardiovascular' }],
  [/^right_ventricle/, 'The heart’s lower right chamber.', 'It pumps oxygen-poor blood into the pulmonary trunk, to the lungs, where the blood picks up oxygen.', { layer: 'cardiovascular' }],
  [/^left_atrium/, 'The heart’s upper left chamber.', 'It receives oxygen-rich blood coming back from the lungs and passes it down to the left ventricle.', { layer: 'cardiovascular' }],
  [/^right_atrium/, 'The heart’s upper right chamber.', 'It receives oxygen-poor blood from the body (through the venae cavae) and passes it to the right ventricle. The heart’s natural pacemaker, the SA node, sits in its wall.', { layer: 'cardiovascular' }],
  [/valve|cusp/, 'A valve of the heart — flaps of tough tissue between chambers or at an exit.', 'Valves let blood flow only one way. Their closing makes the “lub-dub” sound of a heartbeat.', { layer: 'cardiovascular' }],
  [/^aorta$|^(ascending|descending|thoracic|abdominal)_aorta|arch_of_aorta/, 'The aorta, the body’s biggest artery, leaving the left ventricle.', 'It carries oxygen-rich blood from the heart; every other artery of the body branches from it.', { layer: 'cardiovascular' }],
  [/pulmonary_trunk|pulmonary_arter/, 'A pulmonary artery — the vessel from the right ventricle to the lungs.', 'It’s the only kind of artery that carries oxygen-poor blood: it takes it to the lungs to be refilled with oxygen.', { layer: 'cardiovascular' }],
  [/pulmonary_vein/, 'A pulmonary vein, from a lung to the left atrium.', 'It’s the only kind of vein that carries oxygen-rich blood — fresh from the lungs, back to the heart.', { layer: 'cardiovascular' }],
  [/vena_cava/, 'A vena cava — one of the two biggest veins, ending in the right atrium.', 'The superior vena cava brings blood back from the head and arms, the inferior one from the trunk and legs.', { layer: 'cardiovascular' }],
  [/coronary/, 'A coronary vessel, on the surface of the heart.', 'The heart muscle needs its own blood supply: coronary arteries feed it and coronary veins drain it. A blocked coronary artery causes a heart attack.', { layer: 'cardiovascular' }],
  [/carotid/, 'A carotid artery, in the neck.', 'It carries blood to the head and brain. It’s the pulse you can feel beside your windpipe.', { layer: 'cardiovascular' }],
  [/jugular/, 'A jugular vein, in the neck.', 'It drains blood from the head, face and brain back toward the heart.', { layer: 'cardiovascular' }],
  [/femoral_arter/, 'The femoral artery, in the thigh.', 'The main artery of the leg; its pulse can be felt in the groin.', { layer: 'cardiovascular' }],
  [/radial_arter/, 'The radial artery, in the forearm.', 'It supplies the forearm and hand. It’s the pulse you feel at your wrist, on the thumb side.', { layer: 'cardiovascular' }],
  [/arter/, 'An artery — a thick-walled blood vessel that carries blood away from the heart.', 'Arteries carry blood under high pressure out to the organs and muscles; that pressure is the pulse you can feel.', { layer: 'cardiovascular', general: true }],
  [/vein|vena\b|venous/, 'A vein — a blood vessel that carries blood back to the heart.', 'Veins have thinner walls than arteries and many have one-way valves, helped along by the squeeze of nearby muscles.', { layer: 'cardiovascular', general: true }],

  // ---------- respiratory ----------
  [/^lungs?$|^(left|right)_lung$/, 'A lung — a spongy, air-filled organ in the chest. The left one is a little smaller, to make room for the heart.', 'Air reaches about 300 million tiny sacs (alveoli), where oxygen passes into the blood and carbon dioxide passes out to be breathed away.', { layer: 'visceral' }],
  [/lobe_of_(left|right)_lung|^(superior|middle|inferior)_lobe/, 'A lobe of a lung. The right lung has three lobes, the left has two.', 'Each lobe has its own branch of the airways and blood vessels, so a surgeon can remove one lobe and leave the rest working.', { layer: 'visceral' }],
  [/^trachea$/, 'The trachea (windpipe), the tube from the voice box down into the chest.', 'It carries air to and from the lungs. C-shaped rings of cartilage keep it open, and its lining sweeps dust and germs up and away.', { layer: 'visceral' }],
  [/bronch/, 'A bronchus — a branch of the airway inside the lungs.', 'The trachea splits into two main bronchi, which branch again and again (like an upside-down tree) to carry air to every part of the lungs.', { layer: 'visceral' }],
  [/^larynx$|laryn/, 'The larynx (voice box), at the top of the windpipe — the bump in the front is the Adam’s apple.', 'Air pushed past its vocal cords makes them vibrate — that’s your voice. It also closes to keep food out of the airway.', { layer: 'visceral' }],
  [/epiglott/, 'The epiglottis — a flap of cartilage above the voice box.', 'When you swallow it folds down over the airway, so food goes into the oesophagus and not into the lungs.', { layer: 'visceral' }],
  [/^nose$|nasal_cavity|nasal/, 'Part of the nose and nasal cavity.', 'It warms, moistens and filters the air you breathe in, and holds the smell receptors.', { layer: 'visceral', general: true }],
  [/pleura/, 'The pleura — a thin, double layer of membrane around each lung.', 'A little fluid between its layers lets the lungs glide smoothly against the chest wall as you breathe.', { layer: 'visceral' }],
  [/^diaphragm$/, 'The diaphragm — a dome-shaped sheet of muscle under the lungs.', 'It is the main breathing muscle: it flattens to pull air in, and relaxes to let it out. Hiccups are sudden spasms of it.'],

  // ---------- digestive ----------
  [/^stomach$|gastr/, 'The stomach — a J-shaped bag of muscle in the upper left of the belly.', 'It churns food with acid and enzymes into a thick liquid (chyme). The acid also kills most germs that come in with food.', { layer: 'visceral' }],
  [/^liver$|lobe_of_liver|hepat/, 'The liver — the largest organ inside the body, in the upper right of the belly.', 'It does hundreds of jobs: makes bile to digest fats, stores sugar and vitamins, cleans drugs and alcohol from the blood, and makes blood proteins.', { layer: 'visceral' }],
  [/gallbladder/, 'The gallbladder — a small pouch under the liver.', 'It stores and concentrates bile, then squeezes it into the small intestine when you eat fatty food.', { layer: 'visceral' }],
  [/bile|cystic_duct|hepatic_duct/, 'A bile duct — a tube that carries bile.', 'It takes bile from the liver and gallbladder to the duodenum, where it breaks fat into tiny drops.', { layer: 'visceral' }],
  [/pancrea/, 'The pancreas — a long gland behind the stomach.', 'It does two jobs: makes digestive juice for the small intestine, and makes the hormones insulin and glucagon that control blood sugar.', { layer: 'visceral' }],
  [/oesophag|esophag/, 'The oesophagus (food pipe), from the throat to the stomach.', 'Waves of muscle (peristalsis) push each swallow down to the stomach — it works even upside down.', { layer: 'visceral' }],
  [/pharyn/, 'The pharynx (throat), behind the nose and mouth.', 'Both food and air pass through it; it leads to the oesophagus and to the voice box.', { layer: 'visceral' }],
  [/duoden/, 'The duodenum — the first part of the small intestine.', 'Bile and pancreatic juice pour in here and break food down further.', { layer: 'visceral' }],
  [/jejun|ileum|small_intestine/, 'Part of the small intestine — a coiled tube about 6 metres long.', 'Most digestion and nearly all absorption of food happen here, through millions of tiny finger-like villi.', { layer: 'visceral' }],
  [/caecum|cecum|appendix/, 'The caecum and appendix, where the small intestine meets the large intestine (lower right).', 'The caecum receives what’s left of digested food. The appendix holds helpful gut bacteria; when it’s infected, that’s appendicitis.', { layer: 'visceral' }],
  [/colon|large_intestine/, 'Part of the large intestine (colon).', 'It absorbs water and salts from what’s left of food, turning it into stool, with the help of trillions of gut bacteria.', { layer: 'visceral' }],
  [/rectum|anal_canal|anus/, 'The rectum and anal canal — the last part of the large intestine.', 'They store stool until you go to the toilet, with ring muscles (sphincters) to hold it in.', { layer: 'visceral' }],
  [/tongue/, 'The tongue — a muscle covered in taste buds.', 'It moves food while you chew, helps you swallow and shapes sounds when you speak.'],
  [/tooth|incisor|canine|premolar|molar/, 'A tooth.', 'Incisors cut, canines tear, premolars and molars crush and grind food. Enamel, its outer layer, is the hardest substance in the body.'],
  [/salivary|parotid|submandibular_gland|sublingual_gland/, 'A salivary gland.', 'It makes saliva, which wets food and starts digesting starch even before you swallow.'],
  [/peritone|omentum|mesenter/, 'Part of the peritoneum — the thin, slippery lining of the belly.', 'It wraps the organs of the belly, holds them in place and lets them slide past each other.', { layer: 'visceral', general: true }],

  // ---------- urinary ----------
  [/^kidney|^renal_(cortex|medulla|pyramid|column|papilla|sinus)/, 'A kidney — a bean-shaped organ, one on each side of the spine, below the ribs.', 'Kidneys filter all your blood about 30 times a day, removing waste and extra water as urine, and keep the blood’s salt and water in balance.', { layer: 'visceral' }],
  [/renal_pelvis/, 'The renal pelvis — the funnel in the middle of a kidney.', 'It collects the urine the kidney makes and passes it into the ureter.', { layer: 'visceral' }],
  [/ureter/, 'A ureter — a thin muscular tube from a kidney to the bladder.', 'Waves of muscle squeeze urine down to the bladder, a few drops every few seconds.', { layer: 'visceral' }],
  [/bladder/, 'The urinary bladder — a stretchy, muscular bag low in the pelvis.', 'It stores urine and can hold about 400–600 mL. When it fills, nerves tell you it’s time to go.', { layer: 'visceral' }],
  [/urethra/, 'The urethra — the tube from the bladder to the outside.', 'Urine leaves the body through it. It’s about 4 cm long in females and about 20 cm in males.', { layer: 'visceral' }],

  // ---------- endocrine ----------
  [/thyroid_gland|^thyroid$|lobe_of_thyroid/, 'The thyroid gland — a butterfly-shaped gland in the front of the neck.', 'Its hormones set the body’s metabolism: how fast you use energy, your heart rate and body temperature. It needs iodine to work.', { layer: 'visceral' }],
  [/parathyroid/, 'A parathyroid gland — four tiny glands behind the thyroid.', 'They make parathyroid hormone, which keeps the calcium in your blood at the right level for nerves and muscles.', { layer: 'visceral' }],
  [/suprarenal|adrenal/, 'An adrenal (suprarenal) gland, sitting on top of a kidney.', 'It makes adrenaline for “fight or flight”, and cortisol and aldosterone, which handle stress, blood sugar and blood pressure.', { layer: 'visceral' }],
  [/hypophysis|pituitar/, 'The pituitary gland (hypophysis) — a pea-sized gland under the brain.', 'Called the “master gland”: its hormones control growth and tell the thyroid, adrenal glands, ovaries and testes what to do.', { layer: 'visceral' }],
  [/pineal/, 'The pineal gland — a tiny gland deep in the brain.', 'It makes melatonin, which rises in the dark and helps you feel sleepy.', { layer: 'visceral' }],
  [/thymus/, 'The thymus — a gland behind the breastbone, largest in children.', 'It trains T cells, the white blood cells that recognise and fight infections. It’s part of both the immune and endocrine systems.'],

  // ---------- reproductive (female) ----------
  [/^uterus$/, 'The uterus (womb) — a hollow, pear-shaped organ of strong muscle in a female’s pelvis, about 7.5 cm long.', 'Each month its lining thickens to receive a fertilised egg; if none arrives, the lining is shed as a period. In pregnancy it stretches to hold a growing baby, then its muscle pushes the baby out.', { layer: 'visceral' }],
  [/cervix/, 'The cervix — the narrow neck of the uterus, opening into the vagina.', 'It lets menstrual blood out and sperm in, stays closed during pregnancy, and widens during birth.', { layer: 'visceral' }],
  [/uterine_tube|fallopian/, 'A uterine (fallopian) tube — about 10 cm long, from the uterus toward an ovary.', 'Its fringed end catches the egg released by the ovary. Fertilisation usually happens here, and tiny hairs move the egg to the uterus.', { layer: 'visceral' }],
  [/^ovary/, 'An ovary — an almond-sized gland on each side of the uterus.', 'Ovaries hold a female’s eggs and release one about once a month. They also make the hormones oestrogen and progesterone.', { layer: 'visceral' }],
  [/^vagina$/, 'The vagina — a muscular tube from the cervix to the outside of the body.', 'It is the birth canal, and the way menstrual blood leaves the body.', { layer: 'visceral' }],
  [/^breast/, 'The breast — on the chest, made of milk glands, ducts and fat.', 'After a baby is born, its glands make milk to feed the baby. Breasts develop at puberty because of oestrogen.'],
  [/mammary_gland/, 'The mammary gland — 15–20 lobes of milk-making tissue arranged like the petals of a daisy.', 'After childbirth, the hormone prolactin makes the lobes produce milk.'],
  [/lactiferous|milk_duct/, 'The milk (lactiferous) ducts — tubes from each lobe of the breast to the nipple.', 'They carry milk from the glands out through the nipple when a baby feeds.'],
  [/nipple/, 'The nipple — where the milk ducts open.', 'A baby feeding at the nipple triggers the hormone oxytocin, which squeezes milk out.'],
  [/areola/, 'The areola — the darker ring of skin around the nipple.', 'Its small bumps are glands that keep the skin soft and protected during breastfeeding.'],

  // ---------- reproductive (male) ----------
  [/^testis/, 'A testis (testicle) — an oval gland in the scrotum.', 'Testes make sperm and the hormone testosterone. They hang outside the body because sperm need to be a little cooler than body temperature.', { layer: 'visceral' }],
  [/epididym/, 'The epididymis — a coiled tube on the back of each testis.', 'Sperm are stored here and finish maturing for a few weeks.', { layer: 'visceral' }],
  [/ductus_deferens|vas_deferens/, 'The ductus (vas) deferens — a tube from the epididymis up into the pelvis.', 'It carries sperm toward the urethra.', { layer: 'visceral' }],
  [/prostat/, 'The prostate — a walnut-sized gland below the bladder in males.', 'It adds a fluid to semen that helps sperm survive and move.', { layer: 'visceral' }],
  [/seminal/, 'A seminal gland (seminal vesicle), behind the bladder.', 'It makes most of the fluid in semen, rich in sugar that gives sperm energy.', { layer: 'visceral' }],
  [/penis|glans|corpus_(cavernosum|spongiosum)/, 'Part of the penis.', 'The penis carries urine and semen out of the body through the urethra.', { layer: 'visceral', general: true }],

  // ---------- lymphatic & immune ----------
  [/spleen/, 'The spleen — a fist-sized organ in the upper left of the belly, behind the stomach.', 'It filters the blood, removes old red blood cells and holds white blood cells that fight germs in the blood.', { layer: 'lymphoid' }],
  [/(palatine|pharyngeal|lingual|tubal)_tonsil/, 'A tonsil — a lump of lymph tissue at the back of the throat.', 'Tonsils catch germs that come in through the mouth and nose, and start the body’s defence against them.', { layer: 'lymphoid' }],
  [/lymph_node/, 'A lymph node — a bean-sized filter along the lymph vessels.', 'Lymph nodes trap germs and are packed with white blood cells. When you’re sick they swell — the “swollen glands” in your neck.', { layer: 'lymphoid' }],
  [/lymph/, 'Part of the lymphatic system.', 'It collects extra fluid from the tissues and returns it to the blood, filtering out germs along the way.', { layer: 'lymphoid', general: true }],

  // ---------- nervous ----------
  [/^brain$|^encephalon/, 'The brain — about 1.4 kg of soft tissue with around 86 billion nerve cells.', 'It controls everything you think, feel and do, from breathing and heartbeat to memory and speech.', { layer: 'nervous' }],
  [/cerebrum|cerebral_hemisphere/, 'The cerebrum — the large, wrinkled top part of the brain, in two halves.', 'It handles thinking, memory, language, the senses and voluntary movement. The left half moves the right side of the body, and the other way round.', { layer: 'nervous' }],
  [/frontal_lobe/, 'The frontal lobe — the front of the brain.', 'It plans, decides, solves problems and controls movement and personality.', { layer: 'nervous' }],
  [/parietal_lobe/, 'The parietal lobe — the top of the brain.', 'It processes touch, temperature and pain, and knows where your body is in space.', { layer: 'nervous' }],
  [/temporal_lobe/, 'The temporal lobe — the side of the brain, near the ears.', 'It handles hearing, understanding language and making memories.', { layer: 'nervous' }],
  [/occipital_lobe/, 'The occipital lobe — the back of the brain.', 'It is the brain’s vision centre: it makes sense of what your eyes see.', { layer: 'nervous' }],
  [/cerebell/, 'The cerebellum — the “little brain” at the back, under the cerebrum.', 'It coordinates movement, balance and posture, and helps you learn skills like riding a bike.', { layer: 'nervous' }],
  [/brainstem|brain_stem|medulla_oblongata|^pons|midbrain/, 'Part of the brainstem, joining the brain to the spinal cord.', 'It runs the automatic jobs that keep you alive: breathing, heartbeat, blood pressure, swallowing and sleep.', { layer: 'nervous' }],
  [/hypothalamus/, 'The hypothalamus — a small area at the base of the brain.', 'It controls body temperature, hunger, thirst and sleep, and tells the pituitary gland which hormones to release.', { layer: 'nervous' }],
  [/thalamus/, 'The thalamus — the brain’s relay station, deep in the middle.', 'Almost every sense (except smell) passes through it on the way to the cerebrum.', { layer: 'nervous' }],
  [/hippocamp/, 'The hippocampus — a curved structure deep in the temporal lobe, shaped like a seahorse.', 'It turns new experiences into long-term memories and helps you find your way.', { layer: 'nervous' }],
  [/corpus_callos/, 'The corpus callosum — a thick band of nerve fibres.', 'It links the left and right halves of the brain so they can share information.', { layer: 'nervous' }],
  [/spinal_cord/, 'The spinal cord — a bundle of nerves inside the backbone.', 'It carries messages between the brain and the body, and handles quick reflexes on its own.', { layer: 'nervous' }],
  [/^eyeball|^eye$|retina|cornea|lens|iris|sclera/, 'Part of the eye.', 'The cornea and lens focus light onto the retina, which turns it into nerve signals for the brain.', { layer: 'nervous', general: true }],
  [/cochlea/, 'The cochlea — a snail-shaped tube in the inner ear.', 'Tiny hair cells inside turn sound vibrations into nerve signals.', { layer: 'nervous' }],
  [/semicircular|vestibul/, 'Part of the inner ear’s balance organ.', 'Fluid moving inside it tells the brain how your head is turning and tilting.', { layer: 'nervous', general: true }],
  [/malleus|incus|stapes|ossicle/, 'One of the three tiny bones of the middle ear (the stapes is the smallest bone in the body).', 'They pass sound vibrations from the eardrum to the inner ear, making them stronger.', { layer: 'nervous' }],
  [/optic_nerve/, 'The optic nerve.', 'It carries signals from the retina to the brain — about a million nerve fibres in each eye.', { layer: 'nervous' }],
  [/vagus/, 'The vagus nerve — a long nerve from the brainstem down to the belly.', 'It slows the heart, controls digestion and helps the body calm down after stress.', { layer: 'nervous' }],
  [/sciatic/, 'The sciatic nerve — the thickest and longest nerve in the body, in the back of the thigh.', 'It controls the muscles of the back of the leg and carries feeling from the leg and foot.', { layer: 'nervous' }],
  [/nerve|plexus/, 'A nerve — a cable of nerve fibres.', 'Nerves carry electrical signals between the brain or spinal cord and the rest of the body: commands out to muscles, feelings back in.', { layer: 'nervous', general: true }],
  [/gyrus|sulcus|cortex/, 'Part of the cerebral cortex, the brain’s wrinkled outer layer.', 'The folds (gyri) and grooves (sulci) pack a large surface into the skull; this outer layer does most of the thinking.', { layer: 'nervous', general: true }],

  // ---------- skeletal ----------
  [/^skull|cranium|cranial/, 'The skull.', 'It protects the brain, holds the eyes, ears and teeth, and gives the face its shape. It is made of 22 bones.', { layer: 'skeletal' }],
  [/mandible/, 'The mandible (lower jaw) — the only skull bone that moves.', 'It holds the lower teeth and moves for chewing and speaking.', { layer: 'skeletal' }],
  [/maxilla/, 'The maxilla (upper jaw).', 'It holds the upper teeth and forms part of the eye sockets, nose and roof of the mouth.', { layer: 'skeletal' }],
  [/^femur/, 'The femur (thigh bone) — the longest and strongest bone in the body.', 'It carries the body’s weight from the hip to the knee; it is about a quarter of your height.', { layer: 'skeletal' }],
  [/^tibia/, 'The tibia (shin bone), the larger of the two lower-leg bones.', 'It carries the body’s weight from the knee to the ankle — you can feel its edge down the front of your leg.', { layer: 'skeletal' }],
  [/^fibula/, 'The fibula — the thin bone beside the tibia.', 'It carries little weight but anchors muscles and helps steady the ankle.', { layer: 'skeletal' }],
  [/^patella/, 'The patella (kneecap).', 'It protects the knee and helps the thigh muscles straighten the leg with more force.', { layer: 'skeletal' }],
  [/^humerus/, 'The humerus — the bone of the upper arm.', 'It runs from the shoulder to the elbow; the “funny bone” is a nerve that passes near its lower end.', { layer: 'skeletal' }],
  [/^radius/, 'The radius — the forearm bone on the thumb side.', 'It turns around the ulna so you can twist your hand palm up or down.', { layer: 'skeletal' }],
  [/^ulna/, 'The ulna — the forearm bone on the little-finger side.', 'It forms the hinge of the elbow with the humerus — the point of your elbow is its end.', { layer: 'skeletal' }],
  [/^scapula/, 'The scapula (shoulder blade).', 'It connects the arm to the body and anchors many shoulder muscles.', { layer: 'skeletal' }],
  [/^clavicle/, 'The clavicle (collarbone).', 'It holds the shoulder out from the body like a strut. It is the most commonly broken bone.', { layer: 'skeletal' }],
  [/sternum/, 'The sternum (breastbone), in the middle of the chest.', 'Most ribs join it by cartilage; together they form a cage that protects the heart and lungs.', { layer: 'skeletal' }],
  [/^rib|costal/, 'A rib — one of 12 pairs of curved bones.', 'The ribs protect the heart and lungs, and move up and out when you breathe in.', { layer: 'skeletal' }],
  [/vertebra|atlas|axis|vertebral_column/, 'A vertebra — one of the 33 bones of the backbone.', 'Stacked together they hold you upright, let you bend and twist, and protect the spinal cord inside.', { layer: 'skeletal' }],
  [/intervertebral_disc|disc/, 'An intervertebral disc — a pad of cartilage between two vertebrae.', 'It cushions the backbone like a shock absorber and lets it bend.', { layer: 'skeletal' }],
  [/sacrum/, 'The sacrum — five vertebrae joined into one triangle at the base of the spine.', 'It joins the spine to the hips and passes the weight of the body to the legs.', { layer: 'skeletal' }],
  [/coccyx/, 'The coccyx (tailbone).', 'A few small joined vertebrae at the end of the spine that anchor muscles and ligaments.', { layer: 'skeletal' }],
  [/hip_bone|ilium|ischium|pubis|pelv/, 'Part of the hip bone (pelvis).', 'The pelvis holds up the organs of the lower belly and joins the spine to the legs. A female pelvis is wider, to make room for birth.', { layer: 'skeletal' }],
  [/carpal|scaphoid|lunate|triquetr|pisiform|trapezi|capitate|hamate/, 'A carpal bone — one of 8 small bones of the wrist.', 'Together they let the wrist bend and turn in many directions.', { layer: 'skeletal' }],
  [/metacarp/, 'A metacarpal — one of the 5 bones of the palm.', 'They connect the wrist to the fingers.', { layer: 'skeletal' }],
  [/tarsal|talus|calcaneus|navicular|cuboid|cuneiform/, 'A tarsal bone — one of 7 bones of the ankle and heel.', 'They carry the body’s weight and form the arches of the foot. The calcaneus is the heel bone.', { layer: 'skeletal' }],
  [/metatars/, 'A metatarsal — one of the 5 long bones of the foot.', 'They form the arch of the foot and push you off the ground when you walk.', { layer: 'skeletal' }],
  [/phalan/, 'A phalanx — a bone of a finger or toe.', 'Each finger and toe has three (the thumb and big toe have two), so they can bend and grip.', { layer: 'skeletal' }],
  [/hyoid/, 'The hyoid bone, in the neck under the jaw.', 'The only bone not joined to another bone; it holds up the tongue and helps you swallow.', { layer: 'skeletal' }],
  [/cartilag/, 'Cartilage — tough, bendy tissue.', 'It cushions joints and shapes parts like the nose, ears and airways.', { layer: 'skeletal', general: true }],
  [/ligament/, 'A ligament — a strong band of tissue.', 'Ligaments tie bone to bone and keep joints stable. A sprain is a stretched or torn ligament.', { layer: 'skeletal', general: true }],

  // ---------- muscular ----------
  [/biceps_brachii/, 'The biceps brachii — the muscle at the front of the upper arm.', 'It bends the elbow and turns the palm up (like turning a key).', { layer: 'muscular' }],
  [/triceps_brachii/, 'The triceps brachii — the muscle at the back of the upper arm.', 'It straightens the elbow; it works opposite the biceps.', { layer: 'muscular' }],
  [/deltoid/, 'The deltoid — the rounded muscle of the shoulder.', 'It lifts the arm out to the side, forward and back. It’s a common spot for injections.', { layer: 'muscular' }],
  [/pectoralis_major/, 'The pectoralis major — the big muscle of the chest.', 'It pulls the arm across the body and helps with pushing.', { layer: 'muscular' }],
  [/rectus_abdominis/, 'The rectus abdominis — the “six-pack” muscle of the belly.', 'It bends the trunk forward and protects the organs of the belly.', { layer: 'muscular' }],
  [/oblique/, 'An oblique muscle of the belly.', 'It twists and bends the trunk to the side and squeezes the belly.', { layer: 'muscular' }],
  [/gluteus_maximus/, 'The gluteus maximus — the largest muscle in the body, in the buttock.', 'It straightens the hip — for standing up, climbing stairs and running.', { layer: 'muscular' }],
  [/quadriceps|rectus_femoris|vastus/, 'Part of the quadriceps — the four muscles at the front of the thigh.', 'They straighten the knee for walking, running, jumping and kicking.', { layer: 'muscular' }],
  [/hamstring|biceps_femoris|semitendinosus|semimembranosus/, 'One of the hamstrings, at the back of the thigh.', 'They bend the knee and pull the thigh back.', { layer: 'muscular' }],
  [/gastrocnemius|soleus|calcaneal_tendon|achilles/, 'A calf muscle (or its Achilles tendon).', 'It lifts the heel for walking, running and standing on tiptoe.', { layer: 'muscular' }],
  [/trapezius/, 'The trapezius — the large diamond-shaped muscle of the upper back and neck.', 'It moves and steadies the shoulder blades and tilts the head.', { layer: 'muscular' }],
  [/latissimus_dorsi/, 'The latissimus dorsi — the broad muscle of the lower back.', 'It pulls the arm down and back, like in swimming or a pull-up.', { layer: 'muscular' }],
  [/masseter|temporalis/, 'A chewing muscle.', 'It closes the jaw with great force — the masseter is one of the strongest muscles for its size.', { layer: 'muscular' }],
  [/sternocleidomastoid/, 'The sternocleidomastoid, on the side of the neck.', 'It turns and bends the head.', { layer: 'muscular' }],
  [/tendon/, 'A tendon — a tough cord of tissue.', 'Tendons tie muscles to bones, so when a muscle shortens the bone moves.', { layer: 'muscular', general: true }],
  [/muscle|musculus/, 'A skeletal muscle.', 'Muscles move the body by shortening (contracting) and pulling on bones. They work in pairs: one pulls, the other pulls back.', { layer: 'muscular', general: true }],

  // ---------- skin ----------
  [/hair/, 'Hair.', 'Hair keeps you warm and protects the skin; eyelashes and eyebrows keep dust and sweat out of the eyes.', { layer: 'regions', general: true }],
  [/nail/, 'A nail — a plate of hard keratin.', 'Nails protect the tips of the fingers and toes and help you pick up small things.', { layer: 'regions' }],
  [/region|skin/, 'An area of the skin — the body’s largest organ.', 'Skin keeps germs out and water in, controls body temperature with sweat, makes vitamin D in sunlight and feels touch, heat and pain.', { layer: 'regions', general: true }],
];

const plain = (id) => String(id || '').replace(/_(l|r)$/, '');

// when nothing more exact is known, what kind of part it is
const KIND = {
  cardiovascular: ['A blood vessel.', 'Blood vessels carry blood around the body: arteries away from the heart, veins back to it.'],
  lymphoid: ['Part of the lymphatic and immune system.', 'It filters the fluid that drains from the tissues and holds white blood cells that fight germs.'],
  nervous: ['Part of the nervous system.', 'The nervous system carries messages between the brain and the body as tiny electrical signals.'],
  skeletal: ['A bone, or part of one.', 'Bones hold the body up, protect the organs, store calcium, and make blood cells inside their marrow.'],
  muscular: ['A skeletal muscle.', 'Muscles move the body by shortening (contracting) and pulling on bones.'],
  regions: ['An area of the skin.', 'Skin is the body’s largest organ: it keeps germs out and water in, and senses touch, heat and pain.'],
};

// { what, does, general } — general: only what kind of part it is (Cassie can say more)
export function factFor(info) {
  const id = plain(info && info.id), layer = info && info.layer;
  for (const [re, what, does, o = {}] of FACTS) {
    if (o.layer && layer && o.layer !== layer) continue;
    if (re.test(id)) return { what, does, general: !!o.general };
  }
  const k = KIND[layer];
  return k ? { what: k[0], does: k[1], general: true } : null;
}
