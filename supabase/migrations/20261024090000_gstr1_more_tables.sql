-- GSTR-1: large B2C sales, notes to unregistered buyers, exports, advances received and
-- adjusted, nil rated, exempt and non-GST supplies, and documents issued, at their sheets in
-- each official workbook.
update public.templates set mappings=jsonb_set(mappings,'{sheets}',mappings->'sheets' || '{"b2cl":4,"cdnur":10,"exp":12,"at":14,"atadj":16,"docs":20,"exemp":18}')
  where form_code='GSTR1' and version='2.0';
update public.templates set mappings=jsonb_set(mappings,'{sheets}',mappings->'sheets' || '{"b2cl":4,"cdnur":10,"exp":12,"at":14,"atadj":16,"docs":21,"exemp":18}')
  where form_code='GSTR1' and version='2.2';
