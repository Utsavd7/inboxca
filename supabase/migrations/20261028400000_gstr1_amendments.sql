-- GSTR-1: amendments of earlier months, at their sheets in each official workbook, and supplies
-- through e-commerce operators (tables 14, 14A, 15 and 15A) in v2.2 only: the v2.0 workbook ships
-- GSTN's sample rows in those sheets, which a filled file would carry along.
update public.templates set mappings=jsonb_set(mappings,'{sheets}',mappings->'sheets' || '{"b2ba":3,"b2cla":5,"b2csa":7,"cdnra":9,"cdnura":11,"expa":13,"ata":15,"atadja":17}')
  where form_code='GSTR1' and version='2.0';
update public.templates set mappings=jsonb_set(mappings,'{sheets}',mappings->'sheets' || '{"b2ba":3,"b2cla":5,"b2csa":7,"cdnra":9,"cdnura":11,"expa":13,"ata":15,"atadja":17,"eco":22,"ecoa":23,"ecob2b":24,"ecourp2b":25,"ecob2c":26,"ecourp2c":27,"ecoab2b":28,"ecoab2c":29,"ecoaurp2b":30,"ecoaurp2c":31}')
  where form_code='GSTR1' and version='2.2';
