import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  menuScroll: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 8,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
  email: {
    fontSize: 13,
  },
  section: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuIcon: {
    width: 28,
    textAlign: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    marginLeft: 12,
  },
  menuHint: {
    fontSize: 12,
    marginRight: 8,
  },
  // Desktop split
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopMenu: {
    width: 380,
    borderRightWidth: 1,
  },
  desktopDetail: {
    flex: 1,
  },
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  detailEmptyText: {
    fontSize: 14,
  },
  detailScroll: {
    flexGrow: 0,
  },
  detailContent: {
    padding: 24,
    paddingBottom: 0,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  formCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  formLabel: {
    fontSize: 14,
    width: 80,
  },
  formValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  formInput: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
  },
  saveBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  // Accounts pane styles
  acctCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acctTabBar: {
    flexGrow: 0,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  acctTabContent: {
    gap: 8,
    paddingRight: 12,
  },
  acctTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  acctTabText: {
    fontSize: 14,
  },
  acctTabCount: {
    fontSize: 12,
    opacity: 0.7,
  },
  acctList: {
    flex: 1,
  },
  acctRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  expandBtn: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  acctRowContent: {
    flex: 1,
  },
  acctRowName: {
    fontSize: 15,
    fontWeight: '500',
  },
  acctRowCode: {
    fontSize: 12,
    marginTop: 1,
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  directionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acctEmpty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  acctEmptyText: {
    fontSize: 14,
  },
});

export const budgetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  content: { width: '85%', maxWidth: 420, borderRadius: 14, padding: 24 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  field: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  btns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
});
