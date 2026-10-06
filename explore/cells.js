/* What each part of the 3D cells is and does — short, accurate, in a student's words.
   `like` is a "think of it as" comparison; `only` marks parts found in one kind of cell. */
export const PARTS = {
  membrane: { name: 'Cell membrane', color: '#6fb6d9', does: 'A thin, flexible double layer of fats (phospholipids) with proteins in it. It wraps the cell and controls what goes in and out.', like: 'the security gate' },
  cytoplasm: { name: 'Cytoplasm', color: '#a9d4ea', does: 'The jelly-like fluid that fills the cell and holds the organelles in place. Many of the cell’s chemical reactions happen here.', like: 'the factory floor' },
  nucleus: { name: 'Nucleus', color: '#8a5cf0', does: 'Holds the cell’s DNA — the instructions for making every protein — and controls what the cell does and when it divides.', like: 'the control room' },
  envelope: { name: 'Nuclear envelope', color: '#b9a3f5', does: 'A double membrane around the nucleus. Its pores let RNA and proteins move in and out.', like: 'the walls and doors of the control room' },
  nucleolus: { name: 'Nucleolus', color: '#4b2aa8', does: 'A dense spot inside the nucleus where ribosomes are made.', like: 'the ribosome factory' },
  rer: { name: 'Rough ER', color: '#3f86e0', does: 'Folded membranes studded with ribosomes. It builds proteins and sends them on to the Golgi apparatus.', like: 'the assembly line' },
  ser: { name: 'Smooth ER', color: '#2fb5a2', does: 'A network of tubes with no ribosomes. It makes lipids (fats), stores calcium and helps break down toxins.', like: 'the lipid workshop' },
  golgi: { name: 'Golgi apparatus', color: '#e2649f', does: 'Stacks of flattened sacs that modify, sort and package proteins into vesicles for delivery.', like: 'the post office' },
  mito: { name: 'Mitochondria', color: '#f08a3c', does: 'Release energy from glucose through cellular respiration and store it as ATP. The folds inside (cristae) give more surface for this.', like: 'the power station' },
  ribosome: { name: 'Ribosomes', color: '#26306e', does: 'Tiny machines that read messenger RNA and join amino acids into proteins. Some float free; others sit on the rough ER.', like: 'the builders' },
  lysosome: { name: 'Lysosomes', color: '#d8a51e', does: 'Small sacs of digestive enzymes that break down worn-out parts, food particles and germs.', like: 'the recycling centre', only: 'animal' },
  peroxisome: { name: 'Peroxisomes', color: '#a9c53a', does: 'Small sacs that break down fatty acids and turn harmful hydrogen peroxide into water and oxygen.', like: 'the clean-up crew' },
  centrioles: { name: 'Centrioles', color: '#c9c9d9', does: 'A pair of short tube bundles at right angles. They help build the spindle that pulls chromosomes apart when the cell divides.', like: 'the tug-of-war anchors', only: 'animal' },
  vesicle: { name: 'Vesicles', color: '#f4a9cb', does: 'Tiny bubbles of membrane that carry materials around the cell and to the membrane.', like: 'the delivery trucks' },
  cytoskeleton: { name: 'Cytoskeleton', color: '#9fb6cc', does: 'A network of protein fibres that gives the cell its shape, holds organelles in place and moves things around.', like: 'the scaffolding and roads' },
  wall: { name: 'Cell wall', color: '#7cc35a', does: 'A stiff layer of cellulose outside the membrane. It supports the cell, keeps its shape and stops it bursting when it fills with water.', like: 'the brick wall around the house', only: 'plant' },
  vacuole: { name: 'Central vacuole', color: '#8fd6ec', does: 'A big sac of cell sap (water, sugars and salts) that can fill most of the cell. Pushing out on the wall, it keeps the plant firm.', like: 'the water tank', only: 'plant' },
  chloroplast: { name: 'Chloroplasts', color: '#3faa4f', does: 'Hold green chlorophyll and carry out photosynthesis: light + carbon dioxide + water → glucose + oxygen. The stacks inside are grana, made of thylakoids.', like: 'the solar panels', only: 'plant' },
  plasmodesmata: { name: 'Plasmodesmata', color: '#4f8f3a', does: 'Tiny channels through the cell wall that link neighbouring plant cells, so water and small molecules can pass between them.', like: 'doorways to the house next door', only: 'plant' },
};

export const CELLS = {
  animal: {
    title: 'Animal cell',
    parts: ['membrane', 'cytoplasm', 'nucleus', 'envelope', 'nucleolus', 'rer', 'ser', 'golgi', 'mito', 'ribosome', 'lysosome', 'peroxisome', 'centrioles', 'vesicle', 'cytoskeleton'],
    note: 'Only in animal cells: centrioles and lysosomes. No cell wall, no chloroplasts, and only small vacuoles.',
  },
  plant: {
    title: 'Plant cell',
    parts: ['wall', 'membrane', 'cytoplasm', 'vacuole', 'chloroplast', 'nucleus', 'envelope', 'nucleolus', 'rer', 'ser', 'golgi', 'mito', 'ribosome', 'peroxisome', 'plasmodesmata'],
    note: 'Only in plant cells: the cell wall, chloroplasts and one big central vacuole.',
  },
};
